import test from "node:test";
import assert from "node:assert/strict";

import { analyzeTag } from "../src/validator.js";

test("accepts common valid tags", () => {
  for (const tag of ["en", "en-US", "zh-Hant-TW", "sl-rozaj-biske", "x-private", "zh-yue", "en-a-bbb-x-a-ccc"]) {
    const result = analyzeTag(tag);
    assert.equal(result.valid, true, tag);
    assert.equal(result.ok, true, tag);
  }
});

test("rejects malformed tags", () => {
  for (const tag of ["a-DE", "de-419-DE", "en-a-bbb-a-ccc", "en-", "en-a", "de-DE-1901-1901"]) {
    const result = analyzeTag(tag);
    assert.equal(result.ok, false, tag);
    assert.equal(result.valid, false, tag);
  }
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
