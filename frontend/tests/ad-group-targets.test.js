import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adGroupEditMode,
  allowedAdGroupTargetings,
  parseCustomKeywords,
  prepareKeywordAdds,
  prepareProductTargetAdds,
  resolveAdGroupAddMode,
} from "../src/lib/adGroupTargets.ts";

describe("adGroupTargets helpers", () => {
  it("allows only auto on auto campaigns", () => {
    assert.deepEqual(allowedAdGroupTargetings("auto"), ["auto"]);
    assert.deepEqual(allowedAdGroupTargetings("AUTO"), ["auto"]);
  });

  it("allows keywords and products on manual/asin campaigns", () => {
    assert.deepEqual(allowedAdGroupTargetings("manual"), ["keywords", "products"]);
    assert.deepEqual(allowedAdGroupTargetings("asin"), ["keywords", "products"]);
    assert.deepEqual(allowedAdGroupTargetings(null), ["keywords", "products"]);
  });

  it("maps ad group targeting_type to edit mode", () => {
    assert.equal(adGroupEditMode("keyword"), "keywords");
    assert.equal(adGroupEditMode("product_target"), "products");
    assert.equal(adGroupEditMode("auto_target"), "auto");
    assert.equal(adGroupEditMode(null, true), "auto");
    assert.equal(adGroupEditMode(null), "unknown");
  });

  it("resolves add-mode so keyword ad groups do not offer ASINs", () => {
    assert.equal(
      resolveAdGroupAddMode({ targetingType: "keyword", keywordCount: 12, productTargetCount: 0 }),
      "keywords",
    );
    assert.equal(
      resolveAdGroupAddMode({ targetingType: null, keywordCount: 5, productTargetCount: 0, nameHint: "IT2 - Keywords Adgroup" }),
      "keywords",
    );
    assert.equal(
      resolveAdGroupAddMode({ targetingType: "product_target", keywordCount: 0, productTargetCount: 3 }),
      "products",
    );
  });

  it("parses custom keyword lists", () => {
    assert.deepEqual(parseCustomKeywords("alpha\nbeta, alpha"), ["alpha", "beta"]);
    assert.equal(parseCustomKeywords("").length, 0);
  });

  it("prepareKeywordAdds dedupes text+match and rejects low bids", () => {
    const prepared = prepareKeywordAdds(
      [
        { keyword: "italy", matchType: "exact", bid: 0.8, source: "suggested" },
        { keyword: "Italy", matchType: "exact", bid: 0.9, source: "suggested" },
        { keyword: "italy", matchType: "phrase", bid: 0.7, source: "custom" },
        { keyword: "amalfi", matchType: "broad", bid: 0.01, source: "suggested" },
      ],
      [{ keyword_text: "lake como", match_type: "exact" }],
    );
    assert.equal(prepared.keywords.length, 2);
    assert.equal(prepared.skippedDuplicate, 1);
    assert.equal(prepared.skippedBid, 1);
    assert.deepEqual(
      prepared.keywords.map((row) => `${row.keyword}:${row.matchType}:${row.source}`),
      ["italy:exact:suggested", "italy:phrase:custom"],
    );
  });

  it("prepareProductTargetAdds matches UI identity and excludes existing targets", () => {
    const prepared = prepareProductTargetAdds(
      [
        { asin: "B012345678", matchType: "exact", bid: 0.8, source: "suggested" },
        { asin: "b012345678", matchType: "exact", bid: 0.9, source: "custom" },
        { asin: "B012345678", matchType: "expanded", bid: 0.7, source: "suggested" },
        { asin: "B087654321", matchType: "exact", bid: 0.6, source: "suggested" },
        { asin: "bad", matchType: "exact", bid: 0.6, source: "custom" },
      ],
      [{ asin: "B087654321", match_type: "exact" }],
    );
    assert.deepEqual(
      prepared.productTargets.map((row) => `${row.asin}:${row.matchType}:${row.source}`),
      ["B012345678:exact:suggested", "B012345678:expanded:suggested"],
    );
    assert.equal(prepared.skippedDuplicate, 2);
    assert.equal(prepared.skippedAsin, 1);
  });
});
