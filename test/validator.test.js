import test from "node:test";
import assert from "node:assert/strict";

import { analyzeTag, explainTag } from "../src/validator.js";

test("accepts common valid tags", () => {
  for (const tag of ["en", "en-US", "zh-Hant-TW", "sl-rozaj-biske", "en-US-x-twain", "zh-yue", "en-a-bbb-x-a-ccc"]) {
    const result = analyzeTag(tag);
    assert.equal(result.valid, true, tag);
    assert.equal(result.ok, true, tag);
  }
});

test("rejects malformed tags", () => {
  for (const tag of ["a-DE", "de-419-DE", "en-", "en-a", "de-DE-1901-1901"]) {
    const result = analyzeTag(tag);
    assert.equal(result.ok, false, tag);
    assert.equal(result.valid, false, tag);
  }
});

test("rejects repeated extension singletons", () => {
  const result = analyzeTag("en-a-bbb-a-ccc");

  assert.equal(result.ok, false);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /duplicate extension singleton 'a'/);
});

test("rejects registry-invalid subtags and extlang prefixes", () => {
  const unknownRegion = analyzeTag("en-QQ");
  assert.equal(unknownRegion.ok, false);
  assert.match(unknownRegion.errors[0], /unknown region/);

  const badExtlang = analyzeTag("en-yue");
  assert.equal(badExtlang.ok, false);
  assert.match(badExtlang.errors.join(" "), /extended language subtag 'yue' must be used with prefix 'zh'/);
});

test("keeps well-formed and valid separate", () => {
  const result = analyzeTag("en-QQ", { mode: "well-formed" });
  assert.equal(result.wellFormed, true);
  assert.equal(result.valid, false);
  assert.equal(result.ok, true);
});

test("surfaces preferred replacements for deprecated tags", () => {
  const region = analyzeTag("en-BU");
  assert.equal(region.ok, true);
  assert.equal(region.preferredTag, "en-MM");
  assert.equal(region.deprecated, true);

  const redundant = analyzeTag("sgn-US");
  assert.equal(redundant.ok, true);
  assert.equal(redundant.preferredTag, "ase");
});

test("explainTag preserves language-extlang-script-region-variant-extension-privateuse order", () => {
  const result = explainTag("zh-yue-Latn-TW-pinyin-u-co-phonebk-x-private");

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.subtags.map((entry) => entry.kind),
    [
      "language",
      "extlang",
      "script",
      "region",
      "variant",
      "extension-singleton",
      "extension",
      "extension",
      "privateuse-singleton",
      "privateuse",
    ],
  );
});

test("explainTag includes registry metadata and suppress-script guidance", () => {
  const result = explainTag("en-Latn-US");
  const language = result.subtags.find((entry) => entry.kind === "language");
  const script = result.subtags.find((entry) => entry.kind === "script");

  assert.equal(language?.registryType, "language");
  assert.equal(language?.suppressScript, "Latn");
  assert.ok(script?.notes.some((note) => /usually omitted/.test(note)));
  assert.ok(result.guidance.some((note) => /usually omitted/.test(note)));
});

test("explainTag covers extlang preference, extension notes, and private use", () => {
  const result = explainTag("zh-yue-Latn-TW-pinyin-u-co-phonebk-x-private");
  const extlang = result.subtags.find((entry) => entry.kind === "extlang");
  const extensionSingleton = result.subtags.find((entry) => entry.kind === "extension-singleton");
  const privateUse = result.subtags.find((entry) => entry.kind === "privateuse");

  assert.ok(extlang?.notes.some((note) => /standalone language subtag 'yue'/.test(note)));
  assert.ok(extensionSingleton?.notes.some((note) => /Unicode locale extension/.test(note)));
  assert.ok(privateUse?.notes.some((note) => /local agreement/.test(note)));
  assert.ok(result.guidance.some((note) => /Extension subtags are validated structurally/.test(note)));
  assert.ok(result.guidance.some((note) => /Private-use subtags reduce interoperability/.test(note)));
});

test("explainTag reports deprecated grandfathered tags", () => {
  const result = explainTag("i-klingon");

  assert.equal(result.kind, "grandfathered");
  assert.equal(result.preferredTag, "tlh");
  assert.ok(result.subtags[0].notes.some((note) => /Grandfathered tag/.test(note)));
  assert.ok(result.guidance.some((note) => /Prefer 'tlh'/.test(note)));
});

test("explainTag keeps malformed tags syntax-only and still breaks down registry-invalid tags", () => {
  const malformed = explainTag("en-");
  assert.equal(malformed.wellFormed, false);
  assert.deepEqual(malformed.subtags, []);
  assert.ok(malformed.guidance[0].includes("not well-formed"));

  const invalid = explainTag("en-QQ");
  assert.equal(invalid.wellFormed, true);
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.subtags.map((entry) => entry.kind), ["language", "region"]);
  assert.match(invalid.errors[0], /unknown region/);
});
