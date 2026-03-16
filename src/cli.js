import { readFile } from "node:fs/promises";
import process from "node:process";

import { analyzeTag, explainTag, formatSubtag } from "./validator.js";

const VERSION = "0.1.0";
const EXIT_CODES = {
  SUCCESS: 0,
  VALIDATION_FAILED: 1,
  INVALID_ARGS: 2,
  IO_ERROR: 3,
  INTERNAL_ERROR: 4,
};
const HELP_USAGE_VALIDATE = "bcp47 [validate] [--mode valid|well-formed] [--stdin|--file PATH] [--json] [--quiet] [TAG...]";
const HELP_USAGE_EXPLAIN = "bcp47 explain [--json] TAG";

class CliError extends Error {
  constructor({ code, message, exitCode, suggestions = [], details = null }) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.suggestions = suggestions;
    this.details = details;
  }
}

function usageText() {
  return [
    "bcp47: validate and explain BCP 47 tags",
    "usage:",
    `  ${HELP_USAGE_VALIDATE}`,
    `  ${HELP_USAGE_EXPLAIN}`,
    "default: validation reads TAG args or stdin when piped; emits JSON when stdout is not a TTY",
    "exit: 0 success/help/version, 1 explanation or validation failed, 2 args/input, 3 io, 4 internal",
  ].join("\n");
}

function versionText() {
  return VERSION;
}

function cliError(code, message, suggestions = [], exitCode = EXIT_CODES.INVALID_ARGS, details = null) {
  return new CliError({ code, message, exitCode, suggestions, details });
}

function isNonTty(stream) {
  return stream?.isTTY !== true;
}

function shouldEmitJson(argv, stdout) {
  return argv.includes("--json") || isNonTty(stdout);
}

function compactResult(result) {
  const payload = {
    tag: result.input,
    ok: result.ok,
    wellFormed: result.wellFormed,
    valid: result.valid,
    kind: result.kind,
  };

  if (result.errors.length > 0) {
    payload.errors = result.errors;
  }

  if (result.warnings.length > 0) {
    payload.warnings = result.warnings;
  }

  if (result.preferredTag) {
    payload.preferred = result.preferredTag;
  }

  if (result.deprecated) {
    payload.deprecated = true;
  }

  return payload;
}

function compactExplanationSubtag(entry) {
  const payload = {
    kind: entry.kind,
    value: entry.value,
    displayValue: entry.displayValue,
    notes: entry.notes,
  };

  if (entry.registryType) {
    payload.registryType = entry.registryType;
  }

  if (entry.descriptions?.length > 0) {
    payload.descriptions = entry.descriptions;
  }

  if (entry.deprecated) {
    payload.deprecated = entry.deprecated;
  }

  if (entry.preferredValue) {
    payload.preferredValue = entry.preferredValue;
  }

  if (entry.prefixes?.length > 0) {
    payload.prefixes = entry.prefixes;
  }

  if (entry.suppressScript) {
    payload.suppressScript = entry.suppressScript;
  }

  if (entry.scope) {
    payload.scope = entry.scope;
  }

  if (entry.macrolanguage) {
    payload.macrolanguage = entry.macrolanguage;
  }

  if (entry.comments?.length > 0) {
    payload.comments = entry.comments;
  }

  if (entry.extensionSingleton) {
    payload.extensionSingleton = entry.extensionSingleton;
  }

  return payload;
}

function summarizeResults(results) {
  const summary = {
    total: results.length,
    pass: results.filter((result) => result.ok).length,
    fail: results.filter((result) => !result.ok).length,
  };
  const warnings = results.reduce((count, result) => count + result.warnings.length, 0);

  if (warnings > 0) {
    summary.warn = warnings;
  }

  return summary;
}

function helpPayload() {
  return {
    type: "help",
    ok: true,
    exit: EXIT_CODES.SUCCESS,
    usage: {
      validate: HELP_USAGE_VALIDATE,
      explain: HELP_USAGE_EXPLAIN,
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
  };
}

function versionPayload() {
  return {
    type: "version",
    ok: true,
    exit: EXIT_CODES.SUCCESS,
    version: VERSION,
  };
}

function validationPayload(results, mode) {
  const ok = results.every((result) => result.ok);

  return {
    type: "validation",
    ok,
    exit: ok ? EXIT_CODES.SUCCESS : EXIT_CODES.VALIDATION_FAILED,
    mode,
    summary: summarizeResults(results),
    results: results.map(compactResult),
  };
}

function explanationPayload(result) {
  const payload = {
    type: "explanation",
    ok: result.ok,
    exit: result.ok ? EXIT_CODES.SUCCESS : EXIT_CODES.VALIDATION_FAILED,
    tag: result.input,
    wellFormed: result.wellFormed,
    valid: result.valid,
    kind: result.kind,
    subtags: result.subtags.map(compactExplanationSubtag),
    guidance: [...result.guidance],
  };

  if (result.errors.length > 0) {
    payload.errors = result.errors;
  }

  if (result.warnings.length > 0) {
    payload.warnings = result.warnings;
  }

  if (result.preferredTag) {
    payload.preferred = result.preferredTag;
  }

  if (result.deprecated) {
    payload.deprecated = true;
  }

  return payload;
}

function errorPayload(error) {
  const payload = {
    type: "error",
    ok: false,
    exit: error.exitCode,
    code: error.code,
    message: error.message,
  };

  if (error.suggestions.length > 0) {
    payload.suggestions = error.suggestions;
  }

  if (error.details) {
    payload.details = error.details;
  }

  return payload;
}

function writeJson(stream, payload) {
  stream.write(`${JSON.stringify(payload)}\n`);
}

function writeTextError(stream, error) {
  stream.write(`${error.code}: ${error.message}\n`);

  for (const suggestion of error.suggestions) {
    stream.write(`try: ${suggestion}\n`);
  }
}

function emitError(error, json, stdout, stderr) {
  if (json) {
    writeJson(stdout, errorPayload(error));
    return;
  }

  writeTextError(stderr, error);
}

function normalizeError(error) {
  if (error instanceof CliError) {
    return error;
  }

  return cliError(
    "internal_error",
    error instanceof Error ? error.message : String(error),
    ["Retry with --json for a structured response.", "Report the failing input if the error persists."],
    EXIT_CODES.INTERNAL_ERROR,
  );
}

function unsupportedExplainOptionError(option) {
  return cliError(
    "unsupported_option",
    `${option} is not supported with 'explain'`,
    ["Use 'bcp47 explain [--json] TAG'.", "Use 'bcp47 validate ...' for validation-only workflows."],
  );
}

function parseArgs(argv) {
  const args = [...argv];
  let command = "validate";

  if (args[0] === "validate" || args[0] === "explain") {
    command = args.shift();
  }

  const options = {
    command,
    mode: "valid",
    stdin: false,
    file: null,
    tags: [],
    help: false,
    version: false,
    quiet: false,
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
      continue;
    }

    if (arg === "--quiet") {
      if (command === "explain") {
        throw unsupportedExplainOptionError("--quiet");
      }
      options.quiet = true;
      continue;
    }

    if (arg === "--stdin") {
      if (command === "explain") {
        throw unsupportedExplainOptionError("--stdin");
      }
      options.stdin = true;
      continue;
    }

    if (arg === "--mode") {
      if (command === "explain") {
        throw unsupportedExplainOptionError("--mode");
      }
      index += 1;
      if (index >= args.length) {
        throw cliError(
          "missing_option_value",
          "--mode requires a value",
          ["Use --mode valid or --mode well-formed.", "Run bcp47 --help to see the full syntax."],
        );
      }
      options.mode = args[index];
      continue;
    }

    if (arg.startsWith("--mode=")) {
      if (command === "explain") {
        throw unsupportedExplainOptionError("--mode");
      }
      options.mode = arg.slice("--mode=".length);
      continue;
    }

    if (arg === "--file") {
      if (command === "explain") {
        throw unsupportedExplainOptionError("--file");
      }
      index += 1;
      if (index >= args.length) {
        throw cliError(
          "missing_option_value",
          "--file requires a path",
          ["Pass a readable file path after --file.", "Use --stdin to read newline-delimited tags from stdin."],
        );
      }
      options.file = args[index];
      continue;
    }

    if (arg.startsWith("--file=")) {
      if (command === "explain") {
        throw unsupportedExplainOptionError("--file");
      }
      options.file = arg.slice("--file=".length);
      continue;
    }

    if (arg.startsWith("-")) {
      throw cliError(
        "unknown_option",
        `unknown option '${arg}'`,
        ["Run bcp47 --help to see supported flags."],
      );
    }

    options.tags.push(arg);
  }

  if (command === "validate" && !["valid", "well-formed"].includes(options.mode)) {
    throw cliError(
      "unsupported_mode",
      `unsupported mode '${options.mode}'`,
      ["Use --mode valid or --mode well-formed.", "Run bcp47 --help to see supported flags."],
    );
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
  const status = result.ok ? "ok" : "fail";
  const notes = result.ok ? result.warnings : result.errors;
  let line = `${status} ${result.input}`;

  if (notes.length > 0) {
    line += ` ${result.ok ? "warn" : "error"}=${JSON.stringify(notes[0])}`;
    if (notes.length > 1) {
      line += ` more=${notes.length - 1}`;
    }
  }

  if (result.ok && result.preferredTag) {
    line += ` preferred=${result.preferredTag}`;
  }

  return line;
}

function formatLabelValue(label, value) {
  return `  ${label}: ${value}`;
}

function formatOptionalBlock(title, items) {
  if (!items || items.length === 0) {
    return null;
  }

  return [
    title,
    ...items.map((item) => `  - ${item}`),
  ].join("\n");
}

function formatEntryPreferredValue(entry) {
  if (!entry.preferredValue) {
    return null;
  }

  if (entry.kind === "region") {
    return formatSubtag(entry.preferredValue, "region");
  }

  if (entry.kind === "script") {
    return formatSubtag(entry.preferredValue, "script");
  }

  if (entry.kind === "grandfathered") {
    return entry.preferredValue;
  }

  return entry.preferredValue.toLowerCase();
}

function formatExplanationEntry(entry, index) {
  const lines = [`  ${index + 1}. ${entry.kind}: ${entry.displayValue}`];

  if (entry.registryType) {
    lines.push(`     registry: ${entry.registryType}`);
  }

  if (entry.descriptions?.length > 0) {
    lines.push(`     descriptions: ${entry.descriptions.join("; ")}`);
  }

  if (entry.scope) {
    lines.push(`     scope: ${entry.scope}`);
  }

  if (entry.macrolanguage) {
    lines.push(`     macrolanguage: ${entry.macrolanguage}`);
  }

  if (entry.suppressScript) {
    lines.push(`     suppress-script: ${entry.suppressScript}`);
  }

  const preferredValue = formatEntryPreferredValue(entry);
  if (preferredValue) {
    lines.push(`     preferred-value: ${preferredValue}`);
  }

  if (entry.prefixes?.length > 0) {
    lines.push(`     prefixes: ${entry.prefixes.join(", ")}`);
  }

  if (entry.comments?.length > 0) {
    lines.push(`     comments: ${entry.comments.join(" | ")}`);
  }

  if (entry.deprecated) {
    lines.push(`     deprecated: ${entry.deprecated}`);
  }

  if (entry.extensionSingleton) {
    lines.push(`     extension-singleton: ${entry.extensionSingleton}`);
  }

  for (const note of entry.notes) {
    lines.push(`     note: ${note}`);
  }

  return lines.join("\n");
}

function formatExplanationText(result) {
  const sections = [
    [
      "tag",
      formatLabelValue("input", result.input),
    ].join("\n"),
    [
      "status",
      formatLabelValue("ok", String(result.ok)),
      formatLabelValue("wellFormed", String(result.wellFormed)),
      formatLabelValue("valid", String(result.valid)),
      formatLabelValue("kind", result.kind),
      ...(result.preferredTag ? [formatLabelValue("preferred", result.preferredTag)] : []),
      ...(result.deprecated ? [formatLabelValue("deprecated", "true")] : []),
    ].join("\n"),
    [
      "subtags",
      ...(result.subtags.length > 0
        ? result.subtags.map(formatExplanationEntry)
        : ["  (none)"]),
    ].join("\n"),
    [
      "guidance",
      ...(result.guidance.length > 0
        ? result.guidance.map((note) => `  - ${note}`)
        : ["  (none)"]),
    ].join("\n"),
  ];

  const warningsBlock = formatOptionalBlock("warnings", result.warnings);
  if (warningsBlock) {
    sections.push(warningsBlock);
  }

  const errorsBlock = formatOptionalBlock("errors", result.errors);
  if (errorsBlock) {
    sections.push(errorsBlock);
  }

  return `${sections.join("\n")}\n`;
}

async function collectValidationTags(options, stdin, stdout, stderr, json) {
  const collectedTags = [...options.tags];

  if (options.file) {
    try {
      const fileText = await readFile(options.file, "utf8");
      collectedTags.push(...splitInputLines(fileText));
    } catch (error) {
      const cliErr = cliError(
        "file_read_failed",
        `failed to read '${options.file}': ${error.message}`,
        ["Check that the file exists and is readable.", "Use --stdin to read newline-delimited tags instead."],
        EXIT_CODES.IO_ERROR,
        { path: options.file },
      );
      emitError(cliErr, json, stdout, stderr);
      return { error: cliErr };
    }
  }

  const shouldReadStdin = options.stdin || (isNonTty(stdin) && collectedTags.length === 0 && !options.file);
  if (shouldReadStdin) {
    try {
      const stdinText = await readStream(stdin);
      collectedTags.push(...splitInputLines(stdinText));
    } catch (error) {
      const cliErr = cliError(
        "stdin_read_failed",
        `failed to read stdin: ${error.message}`,
        ["Retry with --stdin or pass tags as arguments."],
        EXIT_CODES.IO_ERROR,
      );
      emitError(cliErr, json, stdout, stderr);
      return { error: cliErr };
    }
  }

  return { tags: collectedTags };
}

function validateExplainArity(options) {
  if (options.tags.length === 1) {
    return null;
  }

  if (options.tags.length === 0) {
    return cliError(
      "no_input",
      "explain requires exactly one language tag",
      ["Use 'bcp47 explain TAG'.", "Use 'bcp47 validate ...' to check multiple tags."],
    );
  }

  return cliError(
    "too_many_tags",
    "explain accepts exactly one language tag",
    ["Use 'bcp47 explain TAG' for a single explanation.", "Use 'bcp47 validate ...' to check multiple tags."],
  );
}

export async function runCli(argv, io = {}) {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const json = shouldEmitJson(argv, stdout);

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    const cliErr = normalizeError(error);
    emitError(cliErr, json, stdout, stderr);
    return cliErr.exitCode;
  }

  try {
    if (options.help || (argv.length === 0 && !isNonTty(stdin))) {
      if (json) {
        writeJson(stdout, helpPayload());
      } else {
        stdout.write(`${usageText()}\n`);
      }
      return EXIT_CODES.SUCCESS;
    }

    if (options.version) {
      if (json) {
        writeJson(stdout, versionPayload());
      } else {
        stdout.write(`${versionText()}\n`);
      }
      return EXIT_CODES.SUCCESS;
    }

    if (options.command === "explain") {
      const arityError = validateExplainArity(options);
      if (arityError) {
        emitError(arityError, json, stdout, stderr);
        return arityError.exitCode;
      }

      const explanation = explainTag(options.tags[0]);
      const payload = explanationPayload(explanation);

      if (json) {
        writeJson(stdout, payload);
      } else {
        stdout.write(formatExplanationText(explanation));
      }

      return payload.exit;
    }

    const collected = await collectValidationTags(options, stdin, stdout, stderr, json);
    if (collected.error) {
      return collected.error.exitCode;
    }

    if (collected.tags.length === 0) {
      const cliErr = cliError(
        "no_input",
        "no language tags provided",
        ["Pass one or more tags as arguments.", "Use --stdin or pipe newline-delimited tags.", "Run bcp47 --help for quick usage."],
      );
      emitError(cliErr, json, stdout, stderr);
      return cliErr.exitCode;
    }

    const results = collected.tags.map((tag) => analyzeTag(tag, { mode: options.mode }));
    const payload = validationPayload(results, options.mode);

    if (!options.quiet) {
      if (json) {
        writeJson(stdout, payload);
      } else {
        stdout.write(`${results.map(formatResultLine).join("\n")}\n`);
      }
    }

    return payload.exit;
  } catch (error) {
    const cliErr = normalizeError(error);
    emitError(cliErr, json, stdout, stderr);
    return cliErr.exitCode;
  }
}
