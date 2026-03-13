import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

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

test("validates direct arguments", async () => {
  const result = await runCli(["en", "en-US"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /OK en/);
  assert.match(result.stdout, /OK en-US/);
});

test("supports stdin input", async () => {
  const result = await runCli(["--stdin"], { input: "en\nen-BU\n" });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /OK en/);
  assert.match(result.stdout, /preferred: en-MM/);
});

test("supports file input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "validate-bcp47-"));
  const filePath = join(dir, "tags.txt");
  await writeFile(filePath, "en\ninvalid-tag-\n", "utf8");

  const result = await runCli(["--file", filePath]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /OK en/);
  assert.match(result.stdout, /INVALID invalid-tag-/);
});

test("supports json output", async () => {
  const result = await runCli(["--json", "en-BU"]);
  assert.equal(result.code, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "valid");
  assert.equal(payload.results[0].preferredTag, "en-MM");
});

test("supports quiet mode", async () => {
  const result = await runCli(["--quiet", "en", "de-419-DE"]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
});
