import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  NEGATIVE_RESULT_LIMIT,
  negativeCountLabel,
  negativeEmptyCopy,
  negativeKeywordTypeLabel,
  negativeProductIdentity,
  negativeProductTypeLabel,
  negativeStateLabel,
  presentNegativeKeyword,
  presentNegativeProduct,
} from "../src/lib/negativeTargeting.ts";

const screen = readFileSync(new URL("../app/more/negative-targeting.tsx", import.meta.url), "utf8");
const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const native = readFileSync(new URL("../src/components/ios/Native.tsx", import.meta.url), "utf8");

test("negative keyword rows use Amazon terminology and parent context", () => {
  const row = presentNegativeKeyword({
    id: "kw-1",
    campaign_id: "campaign-1",
    ad_group_id: "group-1",
    keyword_text: "low content books",
    match_type: "negativeExact",
    state: "enabled",
    amazon_profile_id: "profile-1",
    campaign_name: "Japan manual",
    ad_group_name: "Ad group one",
    created_at: "2026-08-22T00:00:00Z",
  });

  assert.equal(row.identity, "low content books");
  assert.equal(row.typeLabel, "Negative exact");
  assert.equal(row.scopeLabel, "Ad group level");
  assert.equal(row.contextLabel, "Japan manual · Ad group one");
  assert.equal(row.stateLabel, "Enabled");
  assert.equal(
    row.accessibilityLabel,
    "low content books. Negative exact. Ad group level. Japan manual · Ad group one. Enabled",
  );
  assert.equal(row.testID, "negative-keyword-kw-1");
});

test("match and state mappings never expose unknown raw enum values", () => {
  assert.equal(negativeKeywordTypeLabel("negativePhrase"), "Negative phrase");
  assert.equal(negativeKeywordTypeLabel("EXACT"), "Negative exact");
  assert.equal(negativeKeywordTypeLabel("vendor_internal_value"), "Negative keyword");
  assert.equal(negativeStateLabel("active"), "Enabled");
  assert.equal(negativeStateLabel("paused"), "Paused");
  assert.equal(negativeStateLabel("vendor_internal_value"), null);
});

test("negative product rows identify ASIN and non-ASIN expressions safely", () => {
  const asin = presentNegativeProduct({
    id: "pt-1",
    campaign_id: "campaign-1",
    ad_group_id: null,
    amazon_profile_id: "profile-1",
    expression: [{ type: "asinSameAs", value: "B012345678" }],
    expression_type: "asinSameAs",
    state: "paused",
    campaign_name: "Books exact",
    created_at: "2026-08-22T00:00:00Z",
    updated_at: null,
  });
  assert.equal(asin.identity, "B012345678");
  assert.equal(asin.typeLabel, "Negative ASIN");
  assert.equal(asin.scopeLabel, "Campaign level");
  assert.equal(asin.contextLabel, "Books exact");
  assert.equal(asin.testID, "negative-product-pt-1");

  assert.equal(
    negativeProductIdentity([{ type: "asinCategorySameAs", value: "Books" }], "asinCategorySameAs"),
    "Books",
  );
  assert.equal(
    negativeProductTypeLabel([{ type: "asinCategorySameAs", value: "Books" }], "asinCategorySameAs"),
    "Negative product target · Category",
  );
  assert.equal(negativeProductIdentity({ unsupported: { nested: true } }, "unknown"), "Product target");
});

test("long and non-English negative identity is preserved", () => {
  const text = "libros de bajo contenido — edición para niños (español)";
  const row = presentNegativeKeyword({
    id: "kw-long",
    campaign_id: "campaign-1",
    ad_group_id: null,
    keyword_text: text,
    match_type: "phrase",
    state: null,
    amazon_profile_id: "profile-1",
    created_at: "2026-08-22T00:00:00Z",
  });
  assert.equal(row.identity, text);
  assert.equal(row.stateLabel, null);
});

test("counts and empty states distinguish search, true empty, and the 500 cap", () => {
  assert.equal(
    negativeCountLabel({ segment: "keywords", sourceCount: 12, filteredCount: 12, searching: false }),
    "12 negative keywords",
  );
  assert.equal(
    negativeCountLabel({ segment: "products", sourceCount: 12, filteredCount: 1, searching: true }),
    "1 matching negative product target",
  );
  assert.equal(
    negativeCountLabel({
      segment: "keywords",
      sourceCount: NEGATIVE_RESULT_LIMIT,
      filteredCount: NEGATIVE_RESULT_LIMIT,
      searching: false,
    }),
    "Latest 500 negative keywords",
  );
  assert.equal(negativeEmptyCopy("keywords", true).title, "No matching negatives");
  assert.equal(negativeEmptyCopy("products", false).title, "No negative product targets");
});

test("screen is read-only, virtualized, searchable, and not date-scoped", () => {
  assert.match(screen, /FlatList/);
  assert.match(screen, /IOSSearchBar/);
  assert.match(screen, /negative-type-filter/);
  assert.match(screen, /RetryState/);
  assert.match(screen, /RefreshControl/);
  assert.match(native, /accessibilityLabel=\{placeholder\}/);
  assert.doesNotMatch(screen, /useMutation|delete|pause|restore|negateSearchTerm|addSearchTermAsTarget/);
  assert.doesNotMatch(screen, /dateRange|showDateRange|useRouter|onPress=/);
});

test("query scope includes signed-in user, selected profiles, and explicit view-as block", () => {
  assert.match(screen, /user\?\.id \?\? "guest"/);
  assert.match(screen, /adminFilterUserId \?\? "self"/);
  assert.match(screen, /selectedProfileIds/);
  assert.match(screen, /Customer negatives unavailable/);
  assert.match(screen, /!viewingCustomer/);
  assert.equal((screen.match(/placeholderData: undefined/g) || []).length, 2);
});

test("negative queries are newest-first, capped, and enrich parent names", () => {
  assert.match(queries, /from\("negative_keywords"\)[\s\S]*order\("created_at", \{ ascending: false \}\)[\s\S]*limit\(NEGATIVE_RESULT_LIMIT\)/);
  assert.match(queries, /from\("negative_product_targets"\)[\s\S]*order\("created_at", \{ ascending: false \}\)[\s\S]*limit\(NEGATIVE_RESULT_LIMIT\)/);
  assert.match(queries, /attachNegativeParentNames/);
  assert.match(queries, /from\("campaigns"\)\.select\("id, name"\)/);
  assert.match(queries, /from\("ad_groups"\)\.select\("id, name"\)/);
});
