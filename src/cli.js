import { readFile } from "node:fs/promises";
import process from "node:process";

import { analyzeTag } from "./validator.js";

function usageText() {
  return `Usage:
  bcp47 <tag>
  bcp47 validate <tag...>
  bcp47 --stdin
  bcp47 --file <path>

Options:
  --mode <valid|well-formed>  Validation mode (default: valid)
  --stdin                     Read newline-delimited tags from stdin
  --file <path>               Read newline-delimited tags from a file
  --json                      Emit JSON output
  --quiet                     Suppress normal output and use exit codes only
  -h, --help                  Show help
  -v, --version               Show version`;
}

function versionText() {
  return "0.1.0";
}

function parseArgs(argv) {
  const args = [...argv];
  if (args[0] === "validate") {
    args.shift();
  }

  const options = {
    mode: "valid",
    json: false,
    quiet: false,
    stdin: false,
    file: null,
    tags: [],
    help: false,
    version: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "-v" || arg === "--version") {
      options.version = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }

    if (arg === "--stdin") {
      options.stdin = true;
      continue;
    }

    if (arg === "--mode") {
      index += 1;
      if (index >= args.length) {
        throw new Error("--mode requires a value");
      }
      options.mode = args[index];
      continue;
    }

    if (arg.startsWith("--mode=")) {
      options.mode = arg.slice("--mode=".length);
      continue;
    }

    if (arg === "--file") {
      index += 1;
      if (index >= args.length) {
        throw new Error("--file requires a path");
      }
      options.file = args[index];
      continue;
    }

    if (arg.startsWith("--file=")) {
      options.file = arg.slice("--file=".length);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`unknown option '${arg}'`);
    }

    options.tags.push(arg);
  }

  if (!["valid", "well-formed"].includes(options.mode)) {
    throw new Error(`unsupported mode '${options.mode}'`);
  }

  return options;
}

function splitInputLines(text) {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readStream(stream) {
  return new Promise((resolve, reject) => {
    let data = "";

    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.on("end", () => resolve(data));
    stream.on("error", reject);
  });
}

function formatResultLine(result) {
  const status = result.ok ? "OK" : "INVALID";
  const notes = result.ok ? result.warnings : result.errors;
  let line = `${status} ${result.input}`;

  if (notes.length > 0) {
    line += `: ${notes[0]}`;
    if (notes.length > 1) {
      line += ` (+${notes.length - 1} more)`;
    }
  }

  if (result.ok && result.preferredTag) {
    line += notes.length > 0 ? `; preferred: ${result.preferredTag}` : `: preferred ${result.preferredTag}`;
  }

  return line;
}

export async function runCli(argv, io = {}) {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    stderr.write(`${error.message}\n`);
    stderr.write(`${usageText()}\n`);
    return 2;
  }

  if (options.help) {
    stdout.write(`${usageText()}\n`);
    return 0;
  }

  if (options.version) {
    stdout.write(`${versionText()}\n`);
    return 0;
  }

  const collectedTags = [...options.tags];

  if (options.file) {
    try {
      const fileText = await readFile(options.file, "utf8");
      collectedTags.push(...splitInputLines(fileText));
    } catch (error) {
      stderr.write(`failed to read '${options.file}': ${error.message}\n`);
      return 2;
    }
  }

  const shouldReadStdin = options.stdin || (!stdin.isTTY && collectedTags.length === 0 && !options.file);
  if (shouldReadStdin) {
    try {
      const stdinText = await readStream(stdin);
      collectedTags.push(...splitInputLines(stdinText));
    } catch (error) {
      stderr.write(`failed to read stdin: ${error.message}\n`);
      return 2;
    }
  }

  if (collectedTags.length === 0) {
    stderr.write("no language tags provided\n");
    stderr.write(`${usageText()}\n`);
    return 2;
  }

  const results = collectedTags.map((tag) => analyzeTag(tag, { mode: options.mode }));
  const ok = results.every((result) => result.ok);

  if (!options.quiet) {
    if (options.json) {
      stdout.write(`${JSON.stringify({ ok, mode: options.mode, results }, null, 2)}\n`);
    } else {
      stdout.write(`${results.map(formatResultLine).join("\n")}\n`);
    }
  }

  return ok ? 0 : 1;
}
