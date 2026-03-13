import { getRegistry } from "./registry.js";

const ALPHA_RE = /^[A-Za-z]+$/;
const ALNUM_RE = /^[A-Za-z0-9]+$/;
const DIGIT_RE = /^\d+$/;
const EXTENSION_SINGLETON_RE = /^[0-9A-WY-Za-wy-z]$/;

function isAlpha(value) {
  return ALPHA_RE.test(value);
}

function isAlnum(value) {
  return ALNUM_RE.test(value);
}

function isDigits(value) {
  return DIGIT_RE.test(value);
}

function isLanguage(value) {
  return value.length >= 2 && value.length <= 8 && isAlpha(value);
}

function isExtlang(value) {
  return value.length === 3 && isAlpha(value);
}

function isScript(value) {
  return value.length === 4 && isAlpha(value);
}

function isRegion(value) {
  return (value.length === 2 && isAlpha(value)) || (value.length === 3 && isDigits(value));
}

function isVariant(value) {
  if (!isAlnum(value)) {
    return false;
  }

  if (value.length >= 5 && value.length <= 8) {
    return true;
  }

  return value.length === 4 && isDigits(value[0]) && isAlnum(value.slice(1));
}

function isExtensionSingleton(value) {
  return value.length === 1 && EXTENSION_SINGLETON_RE.test(value);
}

function formatSubtag(value, kind) {
  if (kind === "script") {
    return value[0].toUpperCase() + value.slice(1).toLowerCase();
  }

  if (kind === "region" && value.length === 2 && isAlpha(value)) {
    return value.toUpperCase();
  }

  return value.toLowerCase();
}

function formatTagParts(parts) {
  return parts.map((part) => formatSubtag(part.value, part.kind)).join("-");
}

function parseRegistryTag(tag) {
  return tag.split("-").map((value) => {
    if (isScript(value)) {
      return { kind: "script", value: value.toLowerCase() };
    }

    if (isRegion(value)) {
      return { kind: "region", value: value.toLowerCase() };
    }

    return { kind: "subtag", value: value.toLowerCase() };
  });
}

function buildBaseResult(input, mode) {
  return {
    input,
    mode,
    ok: false,
    wellFormed: false,
    valid: false,
    errors: [],
    warnings: [],
    preferredTag: null,
    deprecated: false,
    kind: "invalid",
  };
}

function invalidResult(input, mode, message) {
  const result = buildBaseResult(input, mode);
  result.errors.push(message);
  return result;
}

function parseTagStructure(input, registry) {
  const trimmed = input.trim();
  const lowerTag = trimmed.toLowerCase();
  const exactGrandfathered = registry.grandfathered[lowerTag];

  if (trimmed.length === 0) {
    return { ok: false, error: "tag is empty" };
  }

  if (/\s/.test(trimmed)) {
    return { ok: false, error: "tag must not contain whitespace" };
  }

  if (trimmed.startsWith("-") || trimmed.endsWith("-")) {
    return { ok: false, error: "empty subtags are not allowed" };
  }

  const subtags = trimmed.split("-");

  for (const subtag of subtags) {
    if (subtag.length === 0) {
      return { ok: false, error: "empty subtags are not allowed" };
    }

    if (!isAlnum(subtag)) {
      return {
        ok: false,
        error: `subtag '${subtag}' must contain only ASCII letters or digits`,
      };
    }

    if (subtag.length > 8) {
      return {
        ok: false,
        error: `subtag '${subtag}' exceeds the maximum length of 8 characters`,
      };
    }
  }

  if (exactGrandfathered) {
    return {
      ok: true,
      kind: "grandfathered",
      exactTagRecord: exactGrandfathered,
      lowerTag,
      subtags: subtags.map((subtag) => subtag.toLowerCase()),
      displayTag: trimmed,
    };
  }

  if (subtags[0].toLowerCase() === "x") {
    if (subtags.length === 1) {
      return { ok: false, error: "private-use tags must include at least one subtag after 'x'" };
    }

    return {
      ok: true,
      kind: "privateuse",
      lowerTag,
      displayTag: trimmed,
      privateUse: subtags.slice(1).map((subtag) => subtag.toLowerCase()),
    };
  }

  const first = subtags[0];
  if (!isLanguage(first)) {
    return {
      ok: false,
      error: "primary language subtag must be 2 to 8 ASCII letters or a grandfathered tag",
    };
  }

  let index = 1;
  const language = first.toLowerCase();
  const extlangs = [];

  while (index < subtags.length && extlangs.length < 3 && isExtlang(subtags[index])) {
    extlangs.push(subtags[index].toLowerCase());
    index += 1;
  }

  let script = null;
  if (index < subtags.length && isScript(subtags[index])) {
    script = subtags[index].toLowerCase();
    index += 1;
  }

  let region = null;
  if (index < subtags.length && isRegion(subtags[index])) {
    region = subtags[index].toLowerCase();
    index += 1;
  }

  const variants = [];
  while (index < subtags.length && isVariant(subtags[index])) {
    variants.push(subtags[index].toLowerCase());
    index += 1;
  }

  const extensions = [];
  while (index < subtags.length && isExtensionSingleton(subtags[index])) {
    const singleton = subtags[index].toLowerCase();
    index += 1;

    const extensionSubtags = [];
    while (index < subtags.length && subtags[index].toLowerCase() !== "x" && !isExtensionSingleton(subtags[index])) {
      if (subtags[index].length < 2) {
        return {
          ok: false,
          error: `extension subtag '${subtags[index]}' must be 2 to 8 characters long`,
        };
      }

      extensionSubtags.push(subtags[index].toLowerCase());
      index += 1;
    }

    if (extensionSubtags.length === 0) {
      return {
        ok: false,
        error: `extension singleton '${singleton}' must be followed by at least one subtag`,
      };
    }

    extensions.push({ singleton, subtags: extensionSubtags });
  }

  let privateUse = [];
  if (index < subtags.length && subtags[index].toLowerCase() === "x") {
    index += 1;

    if (index >= subtags.length) {
      return { ok: false, error: "private-use sequence must include at least one subtag" };
    }

    privateUse = subtags.slice(index).map((subtag) => subtag.toLowerCase());
    index = subtags.length;
  }

  if (index !== subtags.length) {
    const unexpected = subtags[index];

    if (script && isScript(unexpected)) {
      return { ok: false, error: "script subtag may appear at most once" };
    }

    if (region && isRegion(unexpected)) {
      return { ok: false, error: "region subtag may appear at most once" };
    }

    if (privateUse.length > 0) {
      return { ok: false, error: "private-use subtags must be last" };
    }

    return { ok: false, error: `unexpected subtag '${unexpected}'` };
  }

  return {
    ok: true,
    kind: "langtag",
    lowerTag,
    displayTag: trimmed,
    language,
    extlangs,
    script,
    region,
    variants,
    extensions,
    privateUse,
  };
}

function matchPrefix(prefix, precedingSubtags) {
  const parts = prefix.toLowerCase().split("-");
  let matched = 0;

  for (const subtag of precedingSubtags) {
    if (subtag === parts[matched]) {
      matched += 1;
      if (matched === parts.length) {
        return true;
      }
    }
  }

  return matched === parts.length;
}

function buildStructuredParts(parsed) {
  const parts = [{ kind: "language", value: parsed.language }];

  for (const extlang of parsed.extlangs) {
    parts.push({ kind: "extlang", value: extlang });
  }

  if (parsed.script) {
    parts.push({ kind: "script", value: parsed.script });
  }

  if (parsed.region) {
    parts.push({ kind: "region", value: parsed.region });
  }

  for (const variant of parsed.variants) {
    parts.push({ kind: "variant", value: variant });
  }

  for (const extension of parsed.extensions) {
    parts.push({ kind: "singleton", value: extension.singleton });
    for (const subtag of extension.subtags) {
      parts.push({ kind: "extension", value: subtag });
    }
  }

  if (parsed.privateUse.length > 0) {
    parts.push({ kind: "privateuse-singleton", value: "x" });
    for (const subtag of parsed.privateUse) {
      parts.push({ kind: "privateuse", value: subtag });
    }
  }

  return parts;
}

function buildPreferredTag(parsed, registry) {
  if (parsed.kind !== "langtag") {
    return null;
  }

  const parts = [];

  if (parsed.extlangs.length === 1) {
    const extlangRecord = registry.extlangs[parsed.extlangs[0]];
    parts.push({
      kind: "language",
      value: (extlangRecord?.preferredValue ?? parsed.extlangs[0]).toLowerCase(),
    });
  } else {
    const languageRecord = registry.languages[parsed.language];
    parts.push({
      kind: "language",
      value: (languageRecord?.preferredValue ?? parsed.language).toLowerCase(),
    });
  }

  if (parsed.script) {
    const scriptRecord = registry.scripts[parsed.script];
    parts.push({
      kind: "script",
      value: (scriptRecord?.preferredValue ?? parsed.script).toLowerCase(),
    });
  }

  if (parsed.region) {
    const regionRecord = registry.regions[parsed.region];
    parts.push({
      kind: "region",
      value: (regionRecord?.preferredValue ?? parsed.region).toLowerCase(),
    });
  }

  for (const variant of parsed.variants) {
    const record = registry.variants[variant];
    parts.push({
      kind: "variant",
      value: (record?.preferredValue ?? variant).toLowerCase(),
    });
  }

  for (const extension of parsed.extensions) {
    parts.push({ kind: "singleton", value: extension.singleton });
    for (const subtag of extension.subtags) {
      parts.push({ kind: "extension", value: subtag });
    }
  }

  if (parsed.privateUse.length > 0) {
    parts.push({ kind: "privateuse-singleton", value: "x" });
    for (const subtag of parsed.privateUse) {
      parts.push({ kind: "privateuse", value: subtag });
    }
  }

  const formatted = formatTagParts(parts);
  const original = formatTagParts(buildStructuredParts(parsed));
  return formatted === original ? null : formatted;
}

function collectWarnings(parsed, registry, result) {
  if (parsed.kind !== "langtag") {
    return;
  }

  const languageRecord = registry.languages[parsed.language];
  if (languageRecord?.deprecated) {
    result.deprecated = true;
    result.warnings.push(
      languageRecord.preferredValue
        ? `language subtag '${parsed.language}' is deprecated; prefer '${languageRecord.preferredValue.toLowerCase()}'`
        : `language subtag '${parsed.language}' is deprecated`,
    );
  }

  for (const extlang of parsed.extlangs) {
    const record = registry.extlangs[extlang];
    if (!record) {
      continue;
    }

    if (record.deprecated) {
      result.deprecated = true;
      result.warnings.push(
        record.preferredValue
          ? `extended language subtag '${extlang}' is deprecated; prefer '${record.preferredValue.toLowerCase()}'`
          : `extended language subtag '${extlang}' is deprecated`,
      );
    } else {
      result.warnings.push(`extended language form '${parsed.language}-${extlang}' is valid but '${extlang}' is preferred`);
    }
  }

  if (parsed.script) {
    const record = registry.scripts[parsed.script];
    if (record?.deprecated) {
      result.deprecated = true;
      result.warnings.push(
        record.preferredValue
          ? `script subtag '${parsed.script}' is deprecated; prefer '${record.preferredValue}'`
          : `script subtag '${parsed.script}' is deprecated`,
      );
    }
  }

  if (parsed.region) {
    const record = registry.regions[parsed.region];
    if (record?.deprecated) {
      result.deprecated = true;
      result.warnings.push(
        record.preferredValue
          ? `region subtag '${parsed.region.toUpperCase()}' is deprecated; prefer '${formatSubtag(record.preferredValue, "region")}'`
          : `region subtag '${parsed.region.toUpperCase()}' is deprecated`,
      );
    }
  }

  const preceding = [parsed.language];
  for (const extlang of parsed.extlangs) {
    preceding.push(extlang);
  }
  if (parsed.script) {
    preceding.push(parsed.script);
  }
  if (parsed.region) {
    preceding.push(parsed.region);
  }

  for (const variant of parsed.variants) {
    const record = registry.variants[variant];
    if (!record) {
      preceding.push(variant);
      continue;
    }

    if (record.deprecated) {
      result.deprecated = true;
      result.warnings.push(
        record.preferredValue
          ? `variant subtag '${variant}' is deprecated; prefer '${record.preferredValue.toLowerCase()}'`
          : `variant subtag '${variant}' is deprecated`,
      );
    }

    if (record.prefixes.length > 0 && !record.prefixes.some((prefix) => matchPrefix(prefix, preceding))) {
      result.warnings.push(
        `variant subtag '${variant}' does not match any recommended registry prefix`,
      );
    }

    preceding.push(variant);
  }
}

function validateStructuredTag(parsed, registry, result) {
  if (parsed.kind === "grandfathered") {
    result.valid = true;
    result.kind = "grandfathered";

    if (parsed.exactTagRecord.deprecated) {
      result.deprecated = true;
      result.warnings.push(
        parsed.exactTagRecord.preferredValue
          ? `tag '${parsed.displayTag}' is deprecated; prefer '${formatTagParts(parseRegistryTag(parsed.exactTagRecord.preferredValue))}'`
          : `tag '${parsed.displayTag}' is deprecated`,
      );
      result.preferredTag = parsed.exactTagRecord.preferredValue
        ? formatTagParts(parseRegistryTag(parsed.exactTagRecord.preferredValue))
        : null;
    }

    return;
  }

  if (parsed.kind === "privateuse") {
    result.valid = true;
    result.kind = "privateuse";
    return;
  }

  result.kind = "langtag";

  const languageRecord = registry.languages[parsed.language];
  if (!languageRecord) {
    result.errors.push(`unknown language subtag '${parsed.language}'`);
  }

  if (parsed.extlangs.length > 1) {
    result.errors.push("BCP 47 validity allows at most one extended language subtag");
  }

  if (parsed.extlangs.length === 1) {
    const extlang = parsed.extlangs[0];
    const record = registry.extlangs[extlang];
    if (!record) {
      result.errors.push(`unknown extended language subtag '${extlang}'`);
    } else if (!record.prefixes.includes(parsed.language)) {
      result.errors.push(`extended language subtag '${extlang}' must be used with prefix '${record.prefixes[0]}'`);
    }
  }

  if (parsed.script && !registry.scripts[parsed.script]) {
    result.errors.push(`unknown script subtag '${parsed.script}'`);
  }

  if (parsed.region && !registry.regions[parsed.region]) {
    result.errors.push(`unknown region subtag '${parsed.region.toUpperCase()}'`);
  }

  const seenVariants = new Set();
  for (const variant of parsed.variants) {
    if (!registry.variants[variant]) {
      result.errors.push(`unknown variant subtag '${variant}'`);
      continue;
    }

    if (seenVariants.has(variant)) {
      result.errors.push(`duplicate variant subtag '${variant}'`);
    }
    seenVariants.add(variant);
  }

  const seenSingletons = new Set();
  for (const extension of parsed.extensions) {
    if (seenSingletons.has(extension.singleton)) {
      result.errors.push(`duplicate extension singleton '${extension.singleton}'`);
    }
    seenSingletons.add(extension.singleton);
  }

  const exactRedundant = registry.redundant[parsed.lowerTag];
  if (exactRedundant?.deprecated) {
    result.deprecated = true;
    result.warnings.push(
      exactRedundant.preferredValue
        ? `tag '${parsed.displayTag}' is deprecated; prefer '${formatTagParts(parseRegistryTag(exactRedundant.preferredValue))}'`
        : `tag '${parsed.displayTag}' is deprecated`,
    );

    if (exactRedundant.preferredValue) {
      result.preferredTag = formatTagParts(parseRegistryTag(exactRedundant.preferredValue));
    }
  }

  collectWarnings(parsed, registry, result);

  if (!result.preferredTag) {
    result.preferredTag = buildPreferredTag(parsed, registry);
  }

  if (result.errors.length === 0) {
    result.valid = true;
  }
}

export function analyzeTag(input, options = {}) {
  const mode = options.mode ?? "valid";
  const registry = options.registry ?? getRegistry();
  const result = buildBaseResult(input, mode);
  const parsed = parseTagStructure(input, registry);

  if (!parsed.ok) {
    result.errors.push(parsed.error);
    return result;
  }

  result.wellFormed = true;
  validateStructuredTag(parsed, registry, result);
  result.ok = mode === "well-formed" ? result.wellFormed : result.valid;

  return result;
}

export function validateTag(input, options = {}) {
  return analyzeTag(input, options);
}
