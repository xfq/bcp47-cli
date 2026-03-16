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
  assert.match(stdout.toString(), /^bcp47: validate BCP 47 tags/m);
  assert.match(stdout.toString(), /^usage: bcp47 /m);
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
  const dir = await mkdtemp(join(tmpdir(), "validate-bcp47-"));
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
    usage: "bcp47 [validate] [--mode valid|well-formed] [--stdin|--file PATH] [--json] [--quiet] [TAG...]",
    notes: [
      "Reads stdin when piped and no TAG is provided.",
      "Writes JSON automatically when stdout is not a TTY.",
    ],
    exitCodes: {
      0: "success|help|version",
      1: "validation_failed",
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

test("keeps text output dense on a tty", async () => {
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
