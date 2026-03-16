import { mkdir, readFile, writeFile } from "node:fs/promises";

const REGISTRY_URL = "https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry";
const DATA_DIR = new URL("../data/", import.meta.url);
const RAW_PATH = new URL("../data/iana-language-subtag-registry.txt", import.meta.url);
const JSON_PATH = new URL("../data/registry.json", import.meta.url);

function appendField(record, field, value) {
  if (!record[field]) {
    record[field] = [];
  }

  record[field].push(value);
}

function parseRegistryText(rawText) {
  const blocks = rawText.split(/\n%%\n/u);
  const header = blocks.shift() ?? "";
  const fileDateMatch = header.match(/^File-Date:\s*(\S+)/mu);
  const fileDate = fileDateMatch?.[1] ?? null;
  const records = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) {
      continue;
    }

    const lines = trimmed.split("\n");
    const record = {};
    let currentField = null;

    for (const line of lines) {
      if (line.startsWith(" ")) {
        if (!currentField) {
          throw new Error(`invalid continuation line: ${line}`);
        }

        const values = record[currentField];
        values[values.length - 1] += ` ${line.trim()}`;
        continue;
      }

      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        throw new Error(`invalid field line: ${line}`);
      }

      const field = line.slice(0, separatorIndex);
      const value = line.slice(separatorIndex + 1).trim();
      appendField(record, field, value);
      currentField = field;
    }

    records.push(record);
  }

  return { fileDate, records };
}

function simplifyRecord(record) {
  return {
    descriptions: record.Description ?? [],
    added: record.Added?.[0] ?? null,
    deprecated: record.Deprecated?.[0] ?? null,
    preferredValue: record["Preferred-Value"]?.[0] ?? null,
    prefixes: record.Prefix ?? [],
    suppressScript: record["Suppress-Script"]?.[0] ?? null,
    scope: record.Scope?.[0] ?? null,
    macrolanguage: record.Macrolanguage?.[0] ?? null,
    comments: record.Comments ?? [],
  };
}

function buildRuntimeData(rawText) {
  const parsed = parseRegistryText(rawText);
  const runtime = {
    fileDate: parsed.fileDate,
    languages: {},
    extlangs: {},
    scripts: {},
    regions: {},
    variants: {},
    grandfathered: {},
    redundant: {},
  };

  for (const record of parsed.records) {
    const type = record.Type?.[0];
    if (!type) {
      continue;
    }

    if (type === "grandfathered" || type === "redundant") {
      const tag = record.Tag?.[0];
      if (!tag) {
        continue;
      }
      runtime[type][tag.toLowerCase()] = simplifyRecord(record);
      continue;
    }

    const subtag = record.Subtag?.[0];
    if (!subtag || !runtime[`${type}s`]) {
      continue;
    }

    runtime[`${type}s`][subtag.toLowerCase()] = simplifyRecord(record);
  }

  return runtime;
}

async function fetchRegistryText(sourceArg) {
  if (sourceArg === "--from-file") {
    const filePath = process.argv[3];
    if (!filePath) {
      throw new Error("--from-file requires a path");
    }
    return readFile(filePath, "utf8");
  }

  const response = await fetch(REGISTRY_URL, {
    headers: {
      "user-agent": "bcp47-cli/0.1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`failed to fetch registry: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function main() {
  const sourceArg = process.argv[2];
  const rawText = await fetchRegistryText(sourceArg);
  const runtimeData = buildRuntimeData(rawText);

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(RAW_PATH, rawText, "utf8");
  await writeFile(JSON_PATH, `${JSON.stringify(runtimeData, null, 2)}\n`, "utf8");

  process.stdout.write(`Wrote registry snapshot for ${runtimeData.fileDate}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
