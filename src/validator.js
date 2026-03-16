import { getRegistry } from "./registry.js";

const ALPHA_RE = /^[A-Za-z]+$/;
const ALNUM_RE = /^[A-Za-z0-9]+$/;
const DIGIT_RE = /^\d+$/;
const EXTENSION_SINGLETON_RE = /^[0-9A-WY-Za-wy-z]$/;

const EXTENSION_GUIDANCE = {
  t: "The 't' extension is for transformed content; the meaning of its following subtags comes from its extension specification, not this registry snapshot.",
  u: "The 'u' extension is the Unicode locale extension; the meaning of its following subtags comes from its extension specification, not this registry snapshot.",
};

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

export function formatSubtag(value, kind) {
  if (kind === "script") {
    return value[0].toUpperCase() + value.slice(1).toLowerCase();
  }

  if (kind === "region" && value.length === 2 && isAlpha(value)) {
    return value.toUpperCase();
  }

  return value.toLowerCase();
}

function formatDisplayValue(kind, value, fallback = value) {
  if (kind === "grandfathered") {
    return fallback;
  }

  if (kind === "script") {
    return formatSubtag(value, "script");
  }

  if (kind === "region") {
    return formatSubtag(value, "region");
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

function buildBaseResult(input, mode = "valid") {
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
      displayTag: trimmed,
      rawSubtags: subtags,
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
      rawSubtags: subtags,
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
    rawSubtags: subtags,
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
  if (parsed.kind === "grandfathered") {
    return [{
      kind: "grandfathered",
      value: parsed.lowerTag,
      displayValue: parsed.displayTag,
    }];
  }

  const parts = [];

  if (parsed.kind === "privateuse") {
    parts.push({ kind: "privateuse-singleton", value: "x", displayValue: "x" });
    for (const subtag of parsed.privateUse) {
      parts.push({
        kind: "privateuse",
        value: subtag,
        displayValue: subtag.toLowerCase(),
      });
    }
    return parts;
  }

  parts.push({
    kind: "language",
    value: parsed.language,
    displayValue: formatDisplayValue("language", parsed.language),
  });

  for (const extlang of parsed.extlangs) {
    parts.push({
      kind: "extlang",
      value: extlang,
      displayValue: formatDisplayValue("extlang", extlang),
    });
  }

  if (parsed.script) {
    parts.push({
      kind: "script",
      value: parsed.script,
      displayValue: formatDisplayValue("script", parsed.script),
    });
  }

  if (parsed.region) {
    parts.push({
      kind: "region",
      value: parsed.region,
      displayValue: formatDisplayValue("region", parsed.region),
    });
  }

  for (const variant of parsed.variants) {
    parts.push({
      kind: "variant",
      value: variant,
      displayValue: formatDisplayValue("variant", variant),
    });
  }

  for (const extension of parsed.extensions) {
    parts.push({
      kind: "extension-singleton",
      value: extension.singleton,
      displayValue: extension.singleton,
      extensionSingleton: extension.singleton,
    });
    for (const subtag of extension.subtags) {
      parts.push({
        kind: "extension",
        value: subtag,
        displayValue: subtag,
        extensionSingleton: extension.singleton,
      });
    }
  }

  if (parsed.privateUse.length > 0) {
    parts.push({ kind: "privateuse-singleton", value: "x", displayValue: "x" });
    for (const subtag of parsed.privateUse) {
      parts.push({
        kind: "privateuse",
        value: subtag,
        displayValue: subtag.toLowerCase(),
      });
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

function analyzeParsedTag(input, parsed, registry, mode) {
  const result = buildBaseResult(input, mode);

  if (!parsed.ok) {
    result.errors.push(parsed.error);
    return result;
  }

  result.wellFormed = true;
  validateStructuredTag(parsed, registry, result);
  result.ok = mode === "well-formed" ? result.wellFormed : result.valid;

  return result;
}

function uniquePush(target, note) {
  if (note && !target.includes(note)) {
    target.push(note);
  }
}

function addCommonRegistryMetadata(entry, registryType, record) {
  if (!registryType) {
    return entry;
  }

  entry.registryType = registryType;

  if (!record) {
    return entry;
  }

  entry.descriptions = [...record.descriptions];

  if (record.deprecated) {
    entry.deprecated = record.deprecated;
  }

  if (record.preferredValue) {
    entry.preferredValue = record.preferredValue;
  }

  if (record.prefixes.length > 0) {
    entry.prefixes = [...record.prefixes];
  }

  if (record.suppressScript) {
    entry.suppressScript = record.suppressScript;
  }

  if (record.scope) {
    entry.scope = record.scope;
  }

  if (record.macrolanguage) {
    entry.macrolanguage = record.macrolanguage;
  }

  if (record.comments.length > 0) {
    entry.comments = [...record.comments];
  }

  return entry;
}

function variantPrefixMismatch(variant, parsed, record) {
  if (!record || record.prefixes.length === 0) {
    return false;
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

  for (const otherVariant of parsed.variants) {
    if (otherVariant === variant) {
      break;
    }
    preceding.push(otherVariant);
  }

  return !record.prefixes.some((prefix) => matchPrefix(prefix, preceding));
}

function buildLanguageNotes(parsed, record) {
  const notes = ["Primary language subtag."];

  if (!record) {
    notes.push("This language subtag was not found in the bundled IANA registry snapshot.");
    return notes;
  }

  if (record.scope === "collection") {
    notes.push("This is a collection subtag; use a more specific language if one is available.");
  }

  if (record.scope === "macrolanguage") {
    notes.push("This is a macrolanguage covering multiple more specific languages.");
  }

  if (record.deprecated) {
    notes.push(
      record.preferredValue
        ? `Deprecated in the registry; prefer '${record.preferredValue.toLowerCase()}' when possible.`
        : "Deprecated in the registry.",
    );
  }

  if (parsed.script && record.suppressScript?.toLowerCase() === parsed.script) {
    notes.push(`The registry suppresses script '${formatSubtag(record.suppressScript, "script")}' for this language, so that script subtag is usually omitted.`);
  }

  return notes;
}

function buildExtlangNotes(parsed, record, value) {
  const notes = ["Extended language subtag."];

  if (!record) {
    notes.push("This extended language subtag was not found in the bundled IANA registry snapshot.");
    return notes;
  }

  if (record.prefixes.length > 0) {
    notes.push(`Registered prefix: ${record.prefixes.map((prefix) => `'${prefix}'`).join(", ")}.`);
  }

  if (record.preferredValue) {
    notes.push(`The standalone language subtag '${record.preferredValue.toLowerCase()}' is usually preferred over '${parsed.language}-${value}'.`);
  }

  if (record.deprecated) {
    notes.push(
      record.preferredValue
        ? `Deprecated in the registry; prefer '${record.preferredValue.toLowerCase()}'.`
        : "Deprecated in the registry.",
    );
  }

  return notes;
}

function buildScriptNotes(parsed, languageRecord, record) {
  const notes = ["Script subtag."];

  if (!record) {
    notes.push("This script subtag was not found in the bundled IANA registry snapshot.");
    return notes;
  }

  if (languageRecord?.suppressScript?.toLowerCase() === parsed.script) {
    notes.push(`This matches the language's Suppress-Script value '${formatSubtag(languageRecord.suppressScript, "script")}', so it is usually omitted.`);
  }

  if (record.deprecated) {
    notes.push(
      record.preferredValue
        ? `Deprecated in the registry; prefer '${record.preferredValue}'.`
        : "Deprecated in the registry.",
    );
  }

  return notes;
}

function buildRegionNotes(record, value) {
  const notes = ["Region subtag."];

  if (!record) {
    notes.push("This region subtag was not found in the bundled IANA registry snapshot.");
    return notes;
  }

  if (isDigits(value)) {
    notes.push("Numeric region subtags usually refer to broader geographic groupings rather than a single country.");
  }

  if (record.deprecated) {
    notes.push(
      record.preferredValue
        ? `Deprecated in the registry; prefer '${formatSubtag(record.preferredValue, "region")}'.`
        : "Deprecated in the registry.",
    );
  }

  for (const comment of record.comments) {
    notes.push(`Registry comment: ${comment}`);
  }

  return notes;
}

function buildVariantNotes(parsed, record, value) {
  const notes = ["Variant subtag."];

  if (!record) {
    notes.push("This variant subtag was not found in the bundled IANA registry snapshot.");
    return notes;
  }

  if (record.prefixes.length > 0) {
    notes.push(`Recommended registry prefix${record.prefixes.length === 1 ? "" : "es"}: ${record.prefixes.join(", ")}.`);
  } else {
    notes.push("This variant does not declare any registry prefixes.");
  }

  if (record.deprecated) {
    notes.push(
      record.preferredValue
        ? `Deprecated in the registry; prefer '${record.preferredValue.toLowerCase()}'.`
        : "Deprecated in the registry.",
    );
  }

  if (variantPrefixMismatch(value, parsed, record)) {
    notes.push("The current tag does not match any recommended registry prefix for this variant; that is a warning, not a hard validity failure.");
  }

  return notes;
}

function buildExtensionSingletonNotes(singleton, count) {
  const notes = [`Introduces the '${singleton}' extension sequence.`];

  if (EXTENSION_GUIDANCE[singleton]) {
    notes.push(EXTENSION_GUIDANCE[singleton]);
  } else {
    notes.push(`The '${singleton}' extension is validated structurally here, but its following subtags are defined outside the core IANA subtag registry.`);
  }

  notes.push(`This extension has ${count} following subtag${count === 1 ? "" : "s"}.`);

  return notes;
}

function buildExtensionNotes(singleton) {
  return [
    `Part of the '${singleton}' extension sequence.`,
    "This CLI validates extension structure, not extension-specific meaning.",
  ];
}

function buildPrivateUseSingletonNotes() {
  return [
    "Introduces the private-use sequence.",
    "Everything after 'x' is defined by private agreement, not by the IANA registry.",
  ];
}

function buildPrivateUseNotes() {
  return [
    "Private-use subtag.",
    "Its meaning is defined only by local agreement between the parties using it.",
  ];
}

function buildGrandfatheredNotes(record) {
  const notes = ["Grandfathered tag kept for backward compatibility."];

  if (record.deprecated) {
    notes.push(
      record.preferredValue
        ? `Deprecated in the registry; prefer '${formatTagParts(parseRegistryTag(record.preferredValue))}'.`
        : "Deprecated in the registry.",
    );
  }

  notes.push("Additional subtags should not be appended to a grandfathered tag.");

  return notes;
}

function buildSubtagEntries(parsed, registry) {
  const parts = buildStructuredParts(parsed);

  if (parsed.kind === "grandfathered") {
    const entry = addCommonRegistryMetadata({
      kind: "grandfathered",
      value: parsed.lowerTag,
      displayValue: parsed.displayTag,
      notes: buildGrandfatheredNotes(parsed.exactTagRecord),
    }, "grandfathered", parsed.exactTagRecord);

    return [entry];
  }

  if (parsed.kind === "privateuse") {
    return parts.map((part) => ({
      kind: part.kind,
      value: part.value,
      displayValue: part.displayValue,
      notes: part.kind === "privateuse-singleton" ? buildPrivateUseSingletonNotes() : buildPrivateUseNotes(),
    }));
  }

  const languageRecord = registry.languages[parsed.language];
  const extensionCounts = new Map(parsed.extensions.map((extension) => [extension.singleton, extension.subtags.length]));

  return parts.map((part) => {
    if (part.kind === "language") {
      return addCommonRegistryMetadata({
        kind: part.kind,
        value: part.value,
        displayValue: part.displayValue,
        notes: buildLanguageNotes(parsed, languageRecord),
      }, "language", languageRecord);
    }

    if (part.kind === "extlang") {
      const record = registry.extlangs[part.value];
      return addCommonRegistryMetadata({
        kind: part.kind,
        value: part.value,
        displayValue: part.displayValue,
        notes: buildExtlangNotes(parsed, record, part.value),
      }, "extlang", record);
    }

    if (part.kind === "script") {
      const record = registry.scripts[part.value];
      return addCommonRegistryMetadata({
        kind: part.kind,
        value: part.value,
        displayValue: part.displayValue,
        notes: buildScriptNotes(parsed, languageRecord, record),
      }, "script", record);
    }

    if (part.kind === "region") {
      const record = registry.regions[part.value];
      return addCommonRegistryMetadata({
        kind: part.kind,
        value: part.value,
        displayValue: part.displayValue,
        notes: buildRegionNotes(record, part.value),
      }, "region", record);
    }

    if (part.kind === "variant") {
      const record = registry.variants[part.value];
      return addCommonRegistryMetadata({
        kind: part.kind,
        value: part.value,
        displayValue: part.displayValue,
        notes: buildVariantNotes(parsed, record, part.value),
      }, "variant", record);
    }

    if (part.kind === "extension-singleton") {
      return {
        kind: part.kind,
        value: part.value,
        displayValue: part.displayValue,
        notes: buildExtensionSingletonNotes(part.extensionSingleton, extensionCounts.get(part.extensionSingleton) ?? 0),
      };
    }

    if (part.kind === "extension") {
      return {
        kind: part.kind,
        value: part.value,
        displayValue: part.displayValue,
        extensionSingleton: part.extensionSingleton,
        notes: buildExtensionNotes(part.extensionSingleton),
      };
    }

    if (part.kind === "privateuse-singleton") {
      return {
        kind: part.kind,
        value: part.value,
        displayValue: part.displayValue,
        notes: buildPrivateUseSingletonNotes(),
      };
    }

    return {
      kind: part.kind,
      value: part.value,
      displayValue: part.displayValue,
      notes: buildPrivateUseNotes(),
    };
  });
}

function buildGuidance(parsed, registry, result) {
  const guidance = [];

  if (parsed.kind === "grandfathered") {
    uniquePush(guidance, "Grandfathered tags are legacy registrations kept for compatibility.");
    if (result.preferredTag) {
      uniquePush(guidance, `Prefer '${result.preferredTag}' for new content.`);
    }
    return guidance;
  }

  if (parsed.kind === "privateuse") {
    uniquePush(guidance, "Private-use tags are only interoperable inside the community that defines them.");
    uniquePush(guidance, "Use a registered language tag instead when one already expresses the meaning you need.");
    return guidance;
  }

  uniquePush(guidance, "Keep tags as short as possible; only add subtags that add useful distinction.");

  const languageRecord = registry.languages[parsed.language];
  const exactRedundant = registry.redundant[parsed.lowerTag];

  if (languageRecord?.scope === "collection") {
    uniquePush(guidance, `Language subtag '${parsed.language}' is a collection; prefer a more specific language when available.`);
  }

  if (languageRecord?.scope === "macrolanguage") {
    uniquePush(guidance, `Language subtag '${parsed.language}' is a macrolanguage; a more specific encompassed language may be better for new tags, but established usage can still favor the macrolanguage.`);
  }

  if (parsed.script && languageRecord?.suppressScript?.toLowerCase() === parsed.script) {
    uniquePush(guidance, `The script '${formatSubtag(languageRecord.suppressScript, "script")}' is the language's Suppress-Script value, so it is usually omitted.`);
  }

  if (parsed.extlangs.length > 0) {
    for (const extlang of parsed.extlangs) {
      const record = registry.extlangs[extlang];
      if (record?.preferredValue) {
        uniquePush(guidance, `The standalone language subtag '${record.preferredValue.toLowerCase()}' is usually preferred over the extlang form '${parsed.language}-${extlang}'.`);
      }
    }
  }

  if (parsed.script) {
    uniquePush(guidance, "Script subtags are only useful when script differences matter for your content or processing.");
  }

  if (parsed.region) {
    uniquePush(guidance, "Region subtags are only useful when geographic variation needs to be distinguished.");
  }

  if (parsed.variants.length > 0) {
    uniquePush(guidance, "Variant registry prefixes are recommendations about context and ordering; a mismatch is a warning, not a validity failure.");
  }

  if (parsed.extensions.length > 0) {
    uniquePush(guidance, "Extension subtags are validated structurally here; their detailed meaning comes from their extension definitions.");
  }

  if (parsed.privateUse.length > 0) {
    uniquePush(guidance, "Private-use subtags reduce interoperability because their meaning is defined only by private agreement.");
  }

  if (exactRedundant?.deprecated && result.preferredTag) {
    uniquePush(guidance, `The exact tag '${parsed.displayTag}' is deprecated in the registry; prefer '${result.preferredTag}'.`);
  }

  return guidance;
}

export function explainTag(input, options = {}) {
  const registry = options.registry ?? getRegistry();
  const parsed = parseTagStructure(input, registry);
  const result = analyzeParsedTag(input, parsed, registry, "valid");
  const explanation = {
    ...result,
    subtags: [],
    guidance: [],
  };

  if (!parsed.ok) {
    explanation.guidance.push("The tag is not well-formed BCP 47 syntax, so no registry-backed subtag breakdown is available.");
    return explanation;
  }

  explanation.subtags = buildSubtagEntries(parsed, registry);
  explanation.guidance = buildGuidance(parsed, registry, result);

  return explanation;
}

export function analyzeTag(input, options = {}) {
  const mode = options.mode ?? "valid";
  const registry = options.registry ?? getRegistry();
  const parsed = parseTagStructure(input, registry);

  return analyzeParsedTag(input, parsed, registry, mode);
}

export function validateTag(input, options = {}) {
  return analyzeTag(input, options);
}
