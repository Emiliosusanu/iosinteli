# InteliAds PostgREST Read Completeness Audit

**Date:** 2026-08-26  
**Scope:** active iOS (`iosapp-inteli`), Nest production lineage (`f25f39dd` / `cddea87a` + mobile dashboard), web Vite client, Chrome KDP helper  
**Mode:** read-integrity audit. No Amazon Ads writes. BidBot auto-apply remains off. No TestFlight. No Dynamic Island.

## Gate

**`POSTGREST READ COMPLETENESS AUDIT: BLOCKED`**

High-risk reads were inventoried. The original Home `campaign_metrics` ACoS path is repaired. Other customer-facing and engine reads still client-sum raw PostgREST pages that production cardinality can push past 1000 rows.

Do not write PASS while those P1 paths remain.

---

## 1. Actual PostgREST limit (production, measured)

| Question | Result |
|---|---|
| DEFAULT MAX ROWS | **1000** |
| Table SELECTs use it | **YES** |
| Views use it | **YES** (same PostgREST `db-max-rows`; not a separate unlimited channel) |
| RPC / set-returning functions | **YES if the function returns >1000 rows.** Single-row / grouped aggregates that stay under 1000 are safe. |
| Service-role requests | **YES — service role does not bypass the cap** |
| User RLS requests | **YES — same PostgREST cap** |
| Explicit `limit=10000` | Still capped at 1000. Response is **HTTP 206** with `Content-Range: 0-999/<total>` |

Evidence (service-role, production):

- `GET /rest/v1/campaign_metrics?select=id&date=gte.2026-08-01&date=lte.2026-08-26&limit=10000` → HTTP 206, `Content-Range: 0-999/9190`, body 1000 rows.
- No `limit`, `date=eq.2026-08-01` → HTTP 206, `0-999/3175`, body 1000 rows.
- RPC `sum_campaign_metrics_by_profile_date` for QA4 month → HTTP 200, `0-103/104` (104 grouped rows, under cap).
- Hosted PostgREST disables `.sum()` (`PGRST123`). No `pgrst.db_max_rows` GUC visible via `SHOW`; behavior is the hosted 1000 default.

Silent truncation signature: HTTP 206 + `Content-Range` total > 1000 + body length 1000. Many JS clients ignore 206 and treat `data` as complete.

---

## 2. Shared complete-read utilities

| Helper | Location | Page size | Stable order | Error | Max-page guard |
|---|---|---|---|---|---|
| `fetchAllPages` | iOS `frontend/src/lib/queries.ts` | 1000 | caller-supplied | throws | **none** |
| `fetchRequiredPages` | iOS Books wrapper | 1000 | caller | typed `BooksReadError` | none |
| `fetchOptionalInPages` | iOS Books enrichment | 1000 + `.in()` chunk 200 | caller | **swallows per-chunk errors** | none |
| `fetchAllPostgrestRows` | Nest `server/src/common/postgrest-pagination.ts` | 1000 | none unless caller adds `.order()` | returns `{ error }` | **none** |
| `fetchAllPostgrestWithIds` | Nest | IDs 200 + rows 1000 | selected columns | returns `{ error }` | none |
| `forEachPostgrestWithIdsPage` | Nest keyset | IDs 200 + rows 1000 | `id` | fails closed on bad ids | none |
| `supabaseSelectAll` | Chrome `extension/sw.js` | 1000 | offset | stops at `maxRows=200000` | silent stop at cap |
| `supabaseSelect` | Chrome | single request | none | none | **first page only** |

Do not force server-aggregation paths through these helpers.

---

## 3. Current production cardinalities

No customer identifiers. Counts as of 2026-08-26.

| Domain | Global rows | Max matching set that matters | vs 1000 |
|---|---|---|---|
| campaigns | 14,249 | max / profile **2,956** | over |
| keywords | 6,126,166 | max / profile **1,014,537**; enabled **906,250** | over |
| product_targets | 5,197,714 | max / profile **1,027,477** | over |
| product_ads | 82,530 | max / profile **23,001** | over |
| search_terms | 46,893 | — | over globally |
| campaign_metrics | 245,221 | max 1d / profile **1,549**; p95 1d **461**; max month / profile **2,033**; profiles with month >1000: **1** | over |
| keyword_metrics | 650,641 | max 1d / profile **348**; max month / profile **7,447** | month over |
| product_target_metrics | 2,975,862 | max month / profile **78,553** | over |
| search_term_metrics | 78,706 | max month / profile **1,068** | over |
| campaign_placement_metrics | 102,730 | max month / profile **3,025**; max 90d via `user_campaigns` **8,791** | over |
| product_ad_metrics | 764,986 | max month / profile **15,454** | over |
| kdp_daily_data | 1,740 | max month / account **26** | under |
| kdp_book_daily_data | 8,700 | max month / account **256**; max / account / day **133** | under for day/month account grain |
| kdp_titles | 2,190 | max / account **1,935** | over |
| kdp_daily_facts | — | max / account / day **3,612** | over |
| bid_recommendations | 966 | — | under |
| user_campaigns | — | max / user **71**; users with >1000 campaigns **0** | under |
| enabled profiles / user | — | max **4** | under |
| BidBot keyword universe | — | max enabled keywords via `user_campaigns` **17,802**; users >1000: **9** | over |
| BidBot target universe | — | max enabled PTs via `user_campaigns` **4,611**; users >1000: **4** | over |
| profiles with >1000 keywords | — | **24** | — |
| profiles with >1000 targets | — | **17** | — |

### QA4 (largest controlled seller, 4 enabled USD profiles)

| Window | campaign_metrics rows | vs 1000 |
|---|---|---|
| Today 2026-08-26 | 42 | under |
| Rolling 7D Aug 20–26 | 294 | under |
| Month Aug 1–26 | **1,064** | **over** |
| 90D May 29–Aug 26 | **3,458** | **over** |

Per-profile month rows: 338 / 258 / 234 / 234 — each under 1000. The overflow is **multi-profile combined**, which is exactly how iOS Home / Campaigns / Targeting placements query.

QA4 entities: 67 campaigns, 11,756 keywords, 3,343 targets, 206 product ads.

---

## 4. Known `campaign_metrics` regression

| Field | Value |
|---|---|
| PATH | iOS Home / Overview ACoS via `fetchCampaignMetricsRange` |
| SOURCE | `campaign_metrics` filtered by selected-profile campaign IDs + date range |
| EXPECTED ROWS | QA4 month **1064** |
| RETURNED ROWS (before fix) | first **1000** |
| CUSTOMER IMPACT | Account ACoS looked plausible, calculated from incomplete spend/sales |
| ROOT CAUSE | Unpaged PostgREST select; HTTP 206 ignored |
| FIX | `fetchAllPages` + campaign-id chunks of 200 + `order(date, campaign_id)` |
| TEST | `frontend/tests/postgrest-read-completeness.test.js` (999/1000/1001/2500 + first-1000 vs remainder changes ACoS) |
| DEPLOY STATUS | iOS source fixed; physical recert still waiting on iPhone 17. Nest `/dashboard/mobile` uses SQL `SUM` and is live (`f25f39dd`). |

ACoS formula unchanged: `SUM(spend) / SUM(ad attributed sales) * 100`. Never average campaign percentages.

---

## 5. Proven remaining truncation bugs

### P1 — iOS `fetchTopCampaignsRange` client-sum

| Field | Value |
|---|---|
| PATH | Home top campaigns, Campaigns tab, Targeting placements |
| FILE | `frontend/src/lib/queries.ts` `fetchTopCampaignsRange` |
| SOURCE | `campaign_metrics` `.in(campaign_id, chunk500)` date range, **no `.range`** |
| EXPECTED ROWS | QA4 month 1064; QA4 90D 3458; fat profile month up to 2033 |
| RETURNED ROWS | first 1000 per chunk |
| CALLER ASSUMPTION | returned rows are every matching metric day |
| CUSTOMER IMPACT | ranking, spend, sales, ACoS, net on campaign cards / placement list |
| ROOT CAUSE | same class as Home ACoS |
| FIX | reuse `fetchAllPages` (or Nest `get_campaigns_aggregated` for sellers) |
| TEST | characterization in `postgrest-read-completeness.test.js` — helper still unpaged |
| DEPLOY STATUS | **not fixed** |

Also unpaged in the same function: `campaigns` (max 2956 / profile) and `product_ads` (max 23001 / profile). QA4 is under those entity caps (67 / 206). Fat profiles are not.

Seller iOS does **not** take the Nest branch unless `filterUserId && hasNestToken()`. Normal seller reads stay on Supabase RLS.

### P1 — iOS `fetchBookCampaignsRange` client-sum

Same unpaged `campaign_metrics` loop. Book-scoped campaign set is usually smaller than account-wide. **Same code class as the proven bug.** Cardinality for a single book is not separately measured above 1000; treat as **PROVEN CODE PATH / POTENTIAL CARDINALITY** until a book-month is counted. Do not present book-campaign totals as guaranteed complete.

### P1 — Nest notification day totals

| Field | Value |
|---|---|
| PATH | order notifications + daily ads summary |
| FILE | `order-notification.evaluator.ts` `loadTotals`; `daily-ads-summary.service.ts` `loadUserDayMetrics` |
| SOURCE | `campaign_metrics` one profile + one Amazon report date, unpaged, then `reduce` |
| EXPECTED ROWS | production max 1d / profile **1549** |
| RETURNED ROWS | 1000 |
| CUSTOMER IMPACT | missed / undercounted order alerts; wrong daily spend/sales/orders push |
| STATUS | **PROVEN CAP EXCEEDED** (cardinality + unpaged client-sum). Not a captured wrong-push screenshot. |
| FIX | SQL `SUM` / reuse `sum_campaign_metrics_by_profile_date` |
| DEPLOY STATUS | **not fixed** |

### P1 — BidBot pool / placement reads

| Field | Value |
|---|---|
| PATH | BidBot recommendation universe |
| FILE | `rotation-pool.ts` `selectRotationPoolKeywords`; `priority-pools.ts` `fetchEnabledKeywords`; `product-target-pools.ts` `fetchEnabledProductTargets`; `campaign-context-loader.ts` placement metrics |
| SOURCE | unpaged `.in(campaign_id, user_campaigns ids)` |
| EXPECTED ROWS | max **17,802** enabled keywords / user; **4,611** enabled PTs / user; **8,791** placement-metric rows / 90d / user |
| RETURNED ROWS | 1000 |
| CUSTOMER IMPACT | recommendations / safety analysis see a truncated entity set. Auto-apply is **OFF**, so this is not writing Amazon. Enabling auto-apply on this input would be P0. |
| STATUS | **PROVEN CAP EXCEEDED** |
| FIX | `fetchAllPostgrestWithIds` / keyset, or SQL pool RPCs. Do not change scoring. |
| DEPLOY STATUS | **not fixed** |

### P1 — Chrome KDP facts verify

| Field | Value |
|---|---|
| PATH | `extension/sw.js` `verifySupabaseDayMatchesBuilt` |
| SOURCE | `kdp_daily_facts` via `supabaseSelect` with `limit=10000` (still capped at 1000) then client-sum royalties/units |
| EXPECTED ROWS | max **3612** facts / account / day |
| RETURNED ROWS | 1000 |
| CUSTOMER IMPACT | verify usually **throws** (loud) when the tail is non-zero. If the unread tail is all zeros, verify can **false-PASS**. Extraction completeness is a separate layer. |
| STATUS | **PROVEN CAP EXCEEDED** on the verify read |
| FIX | `supabaseSelectAll` or SQL `SUM` |
| DEPLOY STATUS | **not fixed** |

---

## 6. Read-path inventory

Statuses: **PROVEN BUG** · **PROVEN SAFE** · **POTENTIAL / NEEDS DATA** · **INTENTIONAL PAGINATION**

| SURFACE | FILE | FUNCTION | SOURCE | FILTER | CARDINALITY | PAGINATION | AGGREGATION | RISK | STATUS | FIX |
|---|---|---|---|---|---|---|---|---|---|---|
| iOS Home ACoS | `queries.ts` | `fetchCampaignMetricsRange` | `campaign_metrics` | selected profiles + dates | QA4 month 1064; 90D 3458 | `fetchAllPages` + id chunks 200 | client SUM then ACoS | was P1 | **PROVEN SAFE** | keep; do not revert |
| iOS Home fallback Today/7D | `queries.ts` / `index.tsx` | same | same | same | 42 / 294 | same | same | low | **PROVEN SAFE** | — |
| Nest mobile Home | `mobile-dashboard.service.ts` | `getMobileHomeSnapshot` | RPC `sum_campaign_metrics_by_profile_date` | owned enabled profiles | 104 grouped rows month | n/a (SQL SUM) | SQL SUM(spend/sales/orders) | none | **PROVEN SAFE** | model path |
| iOS top campaigns | `queries.ts` | `fetchTopCampaignsRange` | `campaign_metrics` | campaign ids + dates | 1064+ | **none** | client SUM | P1 | **PROVEN BUG** | paginate or Nest aggregate |
| iOS top campaigns entities | same | same | `campaigns`, `product_ads` | profile ids | max 2956 / 23001 | **none** | list | P1 fat / QA4 safe | **PROVEN CAP** fat; QA4 under | `fetchAllPages` |
| iOS book campaigns | `queries.ts` | `fetchBookCampaignsRange` | `campaign_metrics` | matched campaigns + dates | book-sized | **none** | client SUM | P1 class | **POTENTIAL / NEEDS DATA** | same as top campaigns |
| iOS top keywords helper | `queries.ts` | `fetchTopKeywordsRange` | `keywords` + `keyword_metrics` | profiles + dates | QA4 11756 kws; month km max 7447 | **none** | client SUM then top N | P1 if used | **PROVEN CAP**; unused by current screens | paginate or delete |
| iOS Targeting keywords | `queries.ts` / `targeting.tsx` | `fetchKeywords` no limit | `keywords` + `keyword_metrics` | profiles + dates | QA4 11756 | `fetchAllPages` + `fetchMetricTotalsByEntity` | per-row totals | perf, not truncation | **PROVEN SAFE** (complete, slow) | prefer Nest RPC / server list |
| iOS Targeting products | `queries.ts` / `targeting.tsx` | `fetchProductTargets` no limit | `product_targets` + `product_target_metrics` | profiles + dates | QA4 3343; fat month 78553 metrics | paged + chunked metrics | per-row totals | perf | **PROVEN SAFE** | server list summaries |
| iOS Targeting placements | `targeting.tsx` | `fetchTopCampaignsRange` limit 500 | see top campaigns | month/90D | 1064+ | **metrics unpaged** | client SUM then slice 500 | P1 | **PROVEN BUG** | fix helper |
| iOS Campaigns tab | `campaigns.tsx` | `fetchTopCampaignsRange` | same | same | same | same | same | P1 | **PROVEN BUG** | fix helper |
| iOS Home keywords strip | `index.tsx` | `fetchKeywords` limit 40 | `keywords` | profiles | 40 | explicit limit | per-row | none | **INTENTIONAL PAGINATION** | keep; do not label as total catalog |
| iOS Home search terms | `index.tsx` | `fetchSearchTerms` limit 8 | `search_terms` | profiles | 8 | explicit limit | per-row | none | **INTENTIONAL PAGINATION** | keep |
| iOS Search Terms screen | `search-terms.tsx` | `fetchSearchTerms` no limit | `search_terms` via campaigns | profiles + dates | global 46893; stm month max 1068 | campaigns **unpaged**; terms `fetchAllPages` per 300 campaigns | `fetchMetricTotalsByEntity` | QA4 campaigns 67 safe; fat 2956 campaigns truncated | **POTENTIAL** fat campaigns list | page campaigns too |
| iOS campaign detail ST | `campaign/[id].tsx` | `fetchSearchTerms` limit 10 | campaign-scoped | 1 campaign | small | intentional | per-row | none | **INTENTIONAL PAGINATION** | — |
| iOS `fetchCampaigns` | `queries.ts` | `fetchCampaigns` | `campaigns` | profiles | max 2956 | **none** | coverage count | P2 fat | **PROVEN CAP** fat; QA4 67 safe | page or exact count |
| iOS coverage overview | `queries.ts` | `fetchDataCoverageOverview` | campaigns + paged metrics + KDP | profiles + dates | mixed | metrics paged; campaigns not | client SUM of paged metrics | P2 campaign count | metrics **PROVEN SAFE** | page campaigns |
| iOS placement mix | `queries.ts` | `fetchPlacementMixRange` | placement metrics | campaign ids + dates | month max 3025 | metrics paged; campaigns unpaged | client SUM | P1 if campaigns truncated | **POTENTIAL** fat | page campaigns |
| iOS placement shares | `queries.ts` | `fetchCampaignPlacementShares` | placement metrics | campaign chunks 500 | month max 3025 | `fetchAllPages` | shares | none if campaign ids complete | **PROVEN SAFE** | — |
| iOS single campaign chart | `queries.ts` | `fetchCampaignMetricsForCampaign` | `campaign_metrics` | 1 campaign + dates | ≤90–365 | unpaged | chart | under | **PROVEN SAFE** | bounded by product |
| iOS keyword/target/ST detail | `queries.ts` | `fetch*ById` + `fetchMetricTotalsByEntity` | `*_metrics` | 1 id + dates | days in range | paged | SUM | under | **PROVEN SAFE** | — |
| iOS Books list | `queries.ts` / `kdpBooksRead.ts` | `fetchTopBooksRange` | `kdp_book_daily_data` + optional ads | linked KDP accounts + selected profiles | month max 256 book-days / account | `fetchRequiredPages` | client SUM royalties/ads | none on core royalties | **PROVEN SAFE** | keep; optional ads may omit |
| iOS Books optional ads | `queries.ts` | `fetchOptionalInPages` | titles / ads / `product_ad_metrics` / campaigns / `campaign_metrics` | chunks 200 | ads month max 15454 | paged, errors swallowed | ads spend on books | P2 | **INTENTIONAL DEGRADE** | fail loud if ads totals are shown as authoritative |
| iOS KDP royalties strip | `queries.ts` | `fetchKdpRoyaltiesRange` | `kdp_daily_data` / `kdp_entries` | linked accounts + dates | month max 26 | unpaged | client SUM | under | **PROVEN SAFE** | — |
| iOS KDP sibling ASINs | `queries.ts` | `fetchLogicalBookAsins` | `kdp_book_daily_data` | account + group_key, no date | all history for group | unpaged | identity only | P3 | **POTENTIAL** | page if needed |
| iOS negatives | `queries.ts` | negative fetches | negatives | profiles | product cap 500 | `.limit(500)` | list | none | **INTENTIONAL PAGINATION** | keep |
| iOS Rule Activity | `queries.ts` / `ruleActivityContract.ts` | `fetchRuleExecutions` | `rule_execution_history` | user rules | 30 | `.limit(30)` | list | none | **INTENTIONAL PAGINATION** | not lifetime total |
| iOS rule entities | `queries.ts` | `fetchRuleExecutionEntities` | `rule_execution_entities` | 200 execution ids | unknown / execution | **unpaged per chunk** | list | P2 | **POTENTIAL / NEEDS DATA** | page if one execution can exceed 1000 |
| iOS sync logs | `queries.ts` | `fetchProfileSyncLogs` | `profile_sync_logs` / `sync_logs` | profiles | 20 / 50 / 80 | explicit limits | list | none | **INTENTIONAL PAGINATION** | — |
| iOS rules list | `queries.ts` | `fetchOptimizationRules` | `optimization_rules` | user | typically <<1000 | unpaged | list | P3 | **POTENTIAL** | page if catalog grows |
| Web Dashboard KPIs | `campaigns.api.ts` / Nest | `/campaigns/aggregated` | SQL RPC | user + dates + profiles | 1 row | n/a | server SUM | none | **PROVEN SAFE** (RPC `.single()`) | — |
| Web Targeting KPIs | `keywords.service.ts` | `get_keywords_aggregated_fast` | SQL RPC | filters | 1 row | n/a | server SUM | none | **PROVEN SAFE** | — |
| Web Targeting KPI fallback | `keywords.service.ts` | `fetchFilteredKeywordMetricRowsForTotals` | keyword metric rows | filters | can exceed 1000 | **paged with exact count** | client SUM of all pages | none | **PROVEN SAFE** | last-resort only |
| Web Targeting page totals | `page-metric-totals.ts` | `pageMetricTotalsFromRows` | painted page rows | current page | page size | n/a | page SUM | none | **INTENTIONAL PAGINATION** | labeled page-scoped |
| Web campaign list `per_page=all` | Nest campaigns | list | campaigns | user | cap 10,000 | API contract | list | P2 | **BOUNDED BY PRODUCT CONTRACT** | not PostgREST silent 1000 |
| Web Books / BidBot UI | Vite client | Nest APIs only | no direct Supabase | — | — | — | — | — | **PROVEN SAFE** as a PostgREST client | audit Nest instead |
| Nest rules evaluation | `rules.service.ts` / `rule-executor.service.ts` | catalog loads | entities / history | scoped | high | `fetchAllPostgrestRows` / keyset | engine | none on those paths | **PROVEN SAFE** | do not change engine logic |
| Nest harvest exists | `rule-executor.service.ts` | dry-run checks | keywords / targets | ad group + text | 1 | `.limit(1)` | exists | none | **PROVEN SAFE** | — |
| Nest mutation claim | `rule-generic-mutation-safety.service.ts` | `claim` | RPC `claim_rule_catalog_mutation` | single entity | 1 | n/a | lock | none | **PROVEN SAFE** | do not change safety semantics |
| Nest mutation schema ping | same | `isSchemaAvailable` | `rule_mutation_attempts` | — | 1 | `.limit(1)` | exists | none | **PROVEN SAFE** | — |
| Nest BidBot apply revert | apply / revert services | entity by id | keywords / targets | single / small `.in` | bounded | usually id-scoped | mutate | none if single-entity | **PROVEN SAFE** when id-scoped | keep |
| Nest BidBot pools | see §5 | enabled entities | keywords / PTs | `user_campaigns` | 17802 / 4611 | **none** | pool then slice | P1 | **PROVEN BUG** | page |
| Nest BidBot placement context | `campaign-context-loader.ts` | `loadCampaignPlacementSummaries` | `campaign_placement_metrics` | 200-id chunks, 90d | 8791 / user | **none** | client SUM | P1 | **PROVEN BUG** | page or SQL |
| Nest 30d campaign perf | `campaigns.service.ts` | `findPerformance30d` | metrics per campaign | `user_campaigns` max 71 × ≤30 days | ≤30 / campaign | unpaged per campaign | client SUM | under | **PROVEN SAFE** | note: averages percents (formula smell, out of scope) |
| Nest notifications | see §5 | day totals | `campaign_metrics` | 1 profile × 1 day | max 1549 | **none** | client SUM | P1 | **PROVEN BUG** | SQL SUM |
| Chrome KDP extract verify | `sw.js` | `verifySupabaseDayMatchesBuilt` | `kdp_daily_facts` | account + day | max 3612 | `supabaseSelect` first 1000 | client SUM | P1 | **PROVEN BUG** | `supabaseSelectAll` or SQL |
| Chrome KDP daily grain | `sw.js` | same | `kdp_daily_data` / `kdp_entries` | account + day | 1 | `limit=1` | compare | none | **PROVEN SAFE** | — |
| Chrome KDP book-day | `sw.js` | same | `kdp_book_daily_data` | account + day | max 133 | `limit=10000` still 1000 | client SUM | under today | **PROVEN SAFE** at current max 133 | watch if grain changes |
| Chrome catalog backfills | `sw.js` | several | titles / links | account | titles max 1935 | mix of Select vs SelectAll | varies | P2 | **POTENTIAL** on remaining `supabaseSelect` | migrate leftovers to SelectAll |
| Admin dashboard | `admin-dashboard.service.ts` | various | PostgREST | admin | high | `fetchAllPostgrestRows` | ops | P3 | **PROVEN SAFE** if helper used | — |

---

## 7. Domain notes

### Dashboard

- iOS Home headline ACoS: paged `fetchCampaignMetricsRange` **PROVEN SAFE**.
- Nest `GET /dashboard/mobile`: SQL aggregate, QA4 month matched direct SQL (2779.41 / 7407.05 / 453). **PROVEN SAFE**. Prefer this over raw rows.
- iOS still falls back to paged raw rows on 404; once the device runs against live Nest it should consume the 200.

### Targets

- List completeness for seller iOS: `fetchAllPages` **yes**.
- The physical ~8s Targets load is the cost of pulling 11,756 keywords + paged metric chunks, not a 1000-row silent bug.
- Placement segment reuses the broken top-campaigns helper — **correctness bug**, not the 8s one.
- Completing pagination on that helper will not make the keyword list slower; replacing keyword list with a server read model would.

### Books

- Core royalties path: `fetchRequiredPages` + `fetchAllPages` + `BOOKS_IN_CHUNK=200` + selected-profile Ads scope + linked KDP accounts.
- Evidence: `books-read-path.test.js` + `postgrest-read-completeness.test.js`.
- **PASS** for max-row risk on the core Books read.
- Optional enrichment can omit ads/cover if a chunk fails — P2, not a silent royalty undercount.
- Extraction completeness is a **separate** gate. A complete PostgREST read of a partial extract is still a partial royalty number.

### Search Terms

- Screen without limit paginates terms per 300 campaigns.
- Campaign id discovery is unpaged. QA4 (67) safe. Fat profiles (2956) can drop campaigns, then miss terms.
- Month `search_term_metrics` max 1068 / profile — metric totals helper is paged, so ST **metrics** are complete once the term ids are complete.

### Keyword / product-target metrics

- iOS list paths that use `fetchMetricTotalsByEntity` are complete.
- Do not change Targeting until a fix is chosen; current seller list is complete and slow.
- Web uses SQL RPC totals, not raw 1000-row sums.

### KDP

- Account-day `kdp_daily_data` (max 26 / month) is under the cap.
- `kdp_daily_facts` (max 3612 / day) is over — Chrome verify is the live risk.
- Titles (max 1935) need paged or exact-count reads if treated as a complete catalog.
- Do not aggregate mixed currency.

### BidBot

- Input universe can be silently first-1000 enabled keywords / targets for 9 / 4 users.
- Auto-apply **OFF**. Do not enable.
- Recommendations / safety analysis from a truncated set: **P1**. Same bug becomes **P0** if auto-apply is turned on.

### Rules

- Evaluation catalog loads that use `fetchAllPostgrestRows` / keyset are complete.
- Harvest existence checks are `.limit(1)`.
- Do not change engine logic.

### Mutation safety

- Claim / lock / `remote_unknown` paths are single-entity or `limit 1`.
- Truncation cannot hide an unresolved lock on those reads.
- **PROVEN SAFE**. Do not modify safety semantics.

### Recent Activity / sync / negatives

- Explicit page sizes (30 / 20 / 50 / 80 / 500). Not a truncation bug **if UI does not call the page count a lifetime total**.

---

## 8. Exact-1000 production observations

| Path | Observed | Classification |
|---|---|---|
| `campaign_metrics` month-to-date all profiles | 206, `0-999/9190` | exact 1000 body, true total 9190 |
| `campaign_metrics` one calendar day all profiles | 206, `0-999/3175` | exact 1000 body, true total 3175 |
| QA4 month selected profiles | 1064 matching; unpaged client would keep 1000 | proven class |
| RPC month grouped | 104 rows, HTTP 200 | under cap |

These are high-value candidates, not customer dumps.

---

## 9. Counts via `rows.length`

Any unpaged select whose `data.length === 1000` must not be treated as an exact total. Prefer `count=exact`, SQL `COUNT(*)`, or a documented page size.

Current offenders if they ever display `rows.length` as a catalog size: `fetchCampaigns`, `fetchTopCampaignsRange` campaign/product-ad loads, BidBot `keywordRows.length`, Chrome facts `facts.length`.

---

## 10. Tests added this audit

| Test | What it proves |
|---|---|
| `frontend/tests/postgrest-read-completeness.test.js` | 999/1000/1001/2500 complete; boundary ids; same-date many entities; first 1000 ACoS ≠ complete ACoS; mid-page error throws; Home + entity-total + Books source contracts; remaining unpaged helpers stay visible |
| Nest `postgrest-pagination.spec.ts` `fetchAllPostgrestRows completeness` | same 999–2500 + 1064-row SUM(spend)/SUM(sales) fixture |
| Existing Nest `fetchAllPostgrestWithIds` 2001-row test | ID-batched pagination already covered |

`fetchAllPages` still has **no max-page guard**. If one is added later it must **throw incomplete**, never return first N.

---

## 11. Fixes introduced this turn

| Kind | What |
|---|---|
| Server aggregations | **none** (mobile dashboard SQL already live) |
| Pagination code fixes | **none** — audit only, except tests |
| Intentional paged reads | documented, not changed |

Recommended next **one** read-integrity unit (do not bundle):

1. iOS `fetchTopCampaignsRange` + `fetchBookCampaignsRange` → `fetchAllPages` (same class as the proven ACoS bug).
2. Separate Nest unit: notification day `SUM` + BidBot pool pagination on `f25f39dd` lineage.
3. Separate Chrome unit: facts verify via `supabaseSelectAll` or SQL.

Performance: paging `fetchTopCampaignsRange` for QA4 month is **2 requests instead of 1** (1064 rows). Fat 90D is a few pages, not a 50-request waterfall. Do **not** page the already-complete Targets keyword list further — it is already the waterfall.

---

## 12. Severity

**P0**

- None live while BidBot auto-apply is off and mutation safety stays single-entity.
- **Would become P0:** enable auto-apply on truncated BidBot pools.

**P1**

- iOS `fetchTopCampaignsRange` / Targeting placements / Campaigns tab / Home top campaigns.
- Nest notification day totals (`loadTotals`, `loadUserDayMetrics`).
- Nest BidBot enabled-keyword / enabled-target / 90d placement-context reads.
- Chrome `kdp_daily_facts` verify first-1000 (false-PASS if unread tail is zero).
- iOS `fetchBookCampaignsRange` (same class; book-month cardinality not separately proven >1000).

**P2**

- Fat-profile unpaged `campaigns` / `product_ads` lists (`fetchCampaigns`, Search Terms campaign discovery, coverage count).
- Books optional enrichment swallowing chunk errors.
- Remaining Chrome `supabaseSelect` catalog reads.
- `fetchAllPages` / `fetchAllPostgrestRows` missing max-page guard (infinite-loop risk, not silent first-N).
- Rule execution entities unpaged per 200 ids.

**P3**

- Admin / internal reads already on `fetchAllPostgrestRows`.
- Unused `fetchTopKeywordsRange` (still a loaded foot-gun).
- KDP sibling-ASIN unpaged identity read.

---

## 13. Remaining potential risks

- Book-detail campaign metrics over long windows (same unpaged helper).
- Search Terms on a fat profile if campaign discovery truncates.
- Chrome leftover single-page account/orphan/backfill selects (not the daily grain).
- Set-returning RPCs that grow past 1000 rows without `.single()` / grouping.
- `fetchAllPostgrestRows` without deterministic `order` under concurrent writes (report-date facts are mostly immutable; live entity tables are not).
- KDP **extraction** completeness is not proven by this DB-read audit.

---

## 14. Final matrix

**KNOWN CAMPAIGN_METRICS BUG:** Home / Overview range helper **FIXED in iOS source**. Nest mobile dashboard **FIXED (SQL)**. iOS top-campaigns / book-campaigns / Nest notification day **NOT FIXED**.

### High-risk paths

| DOMAIN | PATH | MAX ROWS | CURRENT READ | COMPLETE? | IMPACT | FIX |
|---|---|---|---|---|---|---|
| campaign_metrics | iOS Home ACoS | QA4 month 1064 | `fetchAllPages` | YES | headline ACoS | keep |
| campaign_metrics | Nest `/dashboard/mobile` | 104 grouped | SQL SUM | YES | Home snapshot | keep |
| campaign_metrics | iOS top / placements | 1064–3458 QA4; 2033 / profile | unpaged | NO | ranking / ACoS | paginate |
| campaign_metrics | Nest notify / daily summary | 1549 / profile / day | unpaged | NO | alerts | SQL SUM |
| keywords | iOS Targeting list | 11756 QA4 | `fetchAllPages` | YES | list (slow) | server model later |
| keywords | BidBot pools | 17802 / user | unpaged | NO | recommendations | page / RPC |
| product_targets | iOS Targeting list | 3343 QA4 | `fetchAllPages` | YES | list | server model later |
| product_targets | BidBot pools | 4611 / user | unpaged | NO | recommendations | page / RPC |
| placement metrics | BidBot context | 8791 / user / 90d | unpaged | NO | placement bids | page / SQL |
| search_terms | iOS ST screen | terms paged; campaigns unpaged | mixed | QA4 YES; fat NO | list / harvest | page campaigns |
| kdp_book_daily | iOS Books | 256 / account / month | `fetchRequiredPages` | YES | royalties | keep |
| kdp_daily_facts | Chrome verify | 3612 / account / day | first 1000 | NO | extract verify | SelectAll / SQL |
| mutation locks | claim RPC | 1 | single | YES | safety | keep |

### Web

No direct Supabase. Dashboard / Targeting KPIs go through Nest SQL RPCs. Page-fallback totals are explicitly page-scoped. Web being “closer” on one ACoS number does **not** prove every web surface; the ones that client-sum raw PostgREST rows were not found in the Vite app.

### iOS

Seller reads use Supabase RLS. Home ACoS and Books core: complete. Top campaigns / placements / book-campaign metrics: not. Targeting lists: complete and expensive.

### Nest

Service role still capped at 1000. Helpers exist and are used by rules / several engines. Notifications and BidBot pools do **not** use them. Mobile dashboard is the model (SQL SUM, ACoS from totals).

### KDP

DB grain for `kdp_daily_data` is under the cap. Facts-per-day is not. Extraction completeness remains a separate validation.

### BidBot / Rules / Mutation / Search Terms / Targets / Books / Dashboard

See inventory and high-risk table.

---

## 15. Completion gate (not met)

| Requirement | Met? |
|---|---|
| All high-risk active reads inventoried | YES |
| Financial aggregates cannot silently truncate | **NO** — top campaigns, notifications, Chrome facts |
| >1000 regression tests where needed | YES for helpers; remaining bugs still unpaged |
| Intentional pagination distinguished | YES |
| KDP extraction completeness separately validated | **NO** — out of this read audit; facts verify itself can truncate |
| Safety-critical reads proven complete/bounded | YES (mutation) / NO (BidBot input) |
| web / iOS / Nest audited | YES |
| No known P0/P1 silent truncation remains | **NO** |

**`POSTGREST READ COMPLETENESS AUDIT: BLOCKED`**

Stop. No TestFlight. No Dynamic Island.
