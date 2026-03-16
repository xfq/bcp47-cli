import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { runCli as runCliInProcess } from "../src/cli.js";

const CLI_PATH = new URL("../bin/bcp47.js", import.meta.url);

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH.pathname, ...args], {
      cwd: new URL("..", import.meta.url).pathname,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

function createWritable(isTTY) {
  let value = "";

  return {
    isTTY,
    write(chunk) {
      value += chunk;
    },
    toString() {
      return value;
    },
  };
}

function createTtyInput() {
  return { isTTY: true };
}

test("auto-switches to json when stdout is piped", async () => {
  const result = await runCli(["en", "en-US"]);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.type, "validation");
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.summary, { total: 2, pass: 2, fail: 0 });
  assert.deepEqual(payload.results[0], {
    tag: "en",
    ok: true,
    wellFormed: true,
    valid: true,
    kind: "langtag",
  });
});

test("shows compact help with no args on a tty", async () => {
  const stdout = createWritable(true);
  const stderr = createWritable(true);
  const code = await runCliInProcess([], {
    stdin: createTtyInput(),
    stdout,
    stderr,
  });

  assert.equal(code, 0);
  assert.equal(stderr.toString(), "");
  assert.match(stdout.toString(), /^bcp47: validate and explain BCP 47 tags/m);
  assert.match(stdout.toString(), /^  bcp47 explain \[--json\] TAG$/m);
});

test("supports stdin input", async () => {
  const result = await runCli(["--stdin"], { input: "en\nen-BU\n" });
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.summary.warn, 1);
  assert.equal(payload.results[1].preferred, "en-MM");
  assert.match(payload.results[1].warnings[0], /deprecated/);
});

test("supports file input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bcp47-cli-"));
  const filePath = join(dir, "tags.txt");
  await writeFile(filePath, "en\ninvalid-tag-\n", "utf8");

  const result = await runCli(["--file", filePath]);
  assert.equal(result.code, 1);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.summary, { total: 2, pass: 1, fail: 1 });
  assert.match(payload.results[1].errors[0], /empty subtags/);
});

test("supports explicit json help and version output", async () => {
  const help = await runCli(["--help", "--json"]);
  assert.equal(help.code, 0);
  assert.deepEqual(JSON.parse(help.stdout), {
    type: "help",
    ok: true,
    exit: 0,
    usage: {
      validate: "bcp47 [validate] [--mode valid|well-formed] [--stdin|--file PATH] [--json] [--quiet] [TAG...]",
      explain: "bcp47 explain [--json] TAG",
    },
    notes: [
      "Validation reads stdin when piped and no TAG is provided.",
      "Explain accepts exactly one tag and does not support --mode, --stdin, --file, or --quiet.",
      "Writes JSON automatically when stdout is not a TTY.",
    ],
    exitCodes: {
      0: "success|help|version",
      1: "validation_failed|explanation_failed",
      2: "invalid_args|no_input",
      3: "io_error",
      4: "internal_error",
    },
  });

  const version = await runCli(["--version", "--json"]);
  assert.equal(version.code, 0);
  assert.deepEqual(JSON.parse(version.stdout), {
    type: "version",
    ok: true,
    exit: 0,
    version: "0.1.0",
  });
});

test("returns structured json errors with suggestions", async () => {
  const result = await runCli(["--mode"]);
  assert.equal(result.code, 2);
  assert.equal(result.stderr, "");

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.type, "error");
  assert.equal(payload.code, "missing_option_value");
  assert.match(payload.message, /--mode requires a value/);
  assert.equal(payload.suggestions.length, 2);
});

test("supports quiet mode", async () => {
  const result = await runCli(["--quiet", "en", "de-419-DE"]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("keeps validation text output dense on a tty", async () => {
  const stdout = createWritable(true);
  const stderr = createWritable(true);
  const code = await runCliInProcess(["en-BU", "de-419-DE"], {
    stdin: createTtyInput(),
    stdout,
    stderr,
  });

  assert.equal(code, 1);
  assert.equal(stderr.toString(), "");
  assert.match(stdout.toString(), /^ok en-BU warn="region subtag 'BU' is deprecated; prefer 'MM'" preferred=en-MM$/m);
  assert.match(stdout.toString(), /^fail de-419-DE error="region subtag may appear at most once"$/m);
});

test("explain emits structured json automatically when stdout is piped", async () => {
  const result = await runCli(["explain", "zh-yue"]);
  assert.equal(result.code, 0);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.type, "explanation");
  assert.equal(payload.preferred, "yue");
  assert.equal(payload.deprecated, true);
  assert.deepEqual(payload.subtags.map((entry) => entry.kind), ["language", "extlang"]);
  assert.ok(payload.guidance.some((note) => /standalone language subtag 'yue'/.test(note)));
});

test("explain keeps text output structured on a tty", async () => {
  const stdout = createWritable(true);
  const stderr = createWritable(true);
  const code = await runCliInProcess(["explain", "en-US"], {
    stdin: createTtyInput(),
    stdout,
    stderr,
  });

  assert.equal(code, 0);
  assert.equal(stderr.toString(), "");
  assert.match(stdout.toString(), /^tag$/m);
  assert.match(stdout.toString(), /^status$/m);
  assert.match(stdout.toString(), /^subtags$/m);
  assert.match(stdout.toString(), /^guidance$/m);
  assert.match(stdout.toString(), /^  1\. language: en$/m);
  assert.match(stdout.toString(), /^  2\. region: US$/m);
});

test("explain handles extension, private-use, and grandfathered tags", async () => {
  const extension = JSON.parse((await runCli(["explain", "de-DE-u-co-phonebk"])).stdout);
  assert.equal(extension.type, "explanation");
  assert.ok(extension.guidance.some((note) => /Extension subtags are validated structurally/.test(note)));
  assert.ok(extension.subtags.some((entry) => entry.kind === "extension-singleton" && /Unicode locale extension/.test(entry.notes.join(" "))));

  const privateUse = JSON.parse((await runCli(["explain", "en-US-x-twain"])).stdout);
  assert.ok(privateUse.subtags.some((entry) => entry.kind === "privateuse"));
  assert.ok(privateUse.guidance.some((note) => /Private-use subtags reduce interoperability/.test(note)));

  const grandfathered = JSON.parse((await runCli(["explain", "i-klingon"])).stdout);
  assert.equal(grandfathered.kind, "grandfathered");
  assert.equal(grandfathered.preferred, "tlh");
});

test("explain reports registry-invalid and malformed tags", async () => {
  const invalid = await runCli(["explain", "en-QQ"]);
  assert.equal(invalid.code, 1);
  const invalidPayload = JSON.parse(invalid.stdout);
  assert.equal(invalidPayload.wellFormed, true);
  assert.equal(invalidPayload.valid, false);
  assert.deepEqual(invalidPayload.subtags.map((entry) => entry.kind), ["language", "region"]);
  assert.match(invalidPayload.errors[0], /unknown region/);

  const malformed = await runCli(["explain", "en-"]);
  assert.equal(malformed.code, 1);
  const malformedPayload = JSON.parse(malformed.stdout);
  assert.equal(malformedPayload.wellFormed, false);
  assert.deepEqual(malformedPayload.subtags, []);
  assert.match(malformedPayload.errors[0], /empty subtags/);
});

test("explain enforces single-tag input and rejects validation-only options", async () => {
  const missing = await runCli(["explain"]);
  assert.equal(missing.code, 2);
  assert.equal(JSON.parse(missing.stdout).code, "no_input");

  const many = await runCli(["explain", "en", "fr"]);
  assert.equal(many.code, 2);
  assert.equal(JSON.parse(many.stdout).code, "too_many_tags");

  const unsupported = await runCli(["explain", "--mode", "valid", "en"]);
  assert.equal(unsupported.code, 2);
  assert.equal(JSON.parse(unsupported.stdout).code, "unsupported_option");
});
