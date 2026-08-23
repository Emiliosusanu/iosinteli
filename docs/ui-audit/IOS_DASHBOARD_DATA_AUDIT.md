# InteliAds iOS — Dashboard / Overview Data + Architecture Audit

Updated: 2026-08-22

Status: `DASHBOARD DATA & ARCHITECTURE: PASS`  
UI: `UI NOT YET REFINED` — do not treat this as a Dashboard visual PASS.

This pass is data truth, metric semantics, source lineage, profile/date/currency scope, and architecture. It is not a layout redesign.

Isolated presentation correction this pass (index.tsx only):

- Missing KDP (`hasKdpData === false`) no longer displays royalties as `$0` or Profit as `−spend`.
- Ads query error no longer displays spend as `$0`.
- Net-profit chart mounts only when KDP is present.
- `royaltyRate` was removed from Overview query keys. Fetch still passes `royaltyRate: 0`. Formula unchanged (`fallbackRoyalties = 0`).

---

## Architecture

### Active vs legacy screens

```text
ACTIVE ROOT
  Tab title: Overview
  Route: frontend/app/(tabs)/index.tsx
  Export: OverviewScreen
  Tab config: frontend/app/(tabs)/_layout.tsx → title "Overview"

INTERNAL NAME
  Dashboard (queries, Nest /dashboard/bootstrap, makeDashboardMonthRange, DashboardActionItem)

LEGACY / UNUSED
  No separate Dashboard / Home / Analytics route.
  Many useQuery hooks remain mounted with enabled: false (hook-order leftovers).
  Local helpers ActionReviewCard, FunnelBars, PlacementMixRows, PulseStat, ZoneHeader
  are still in the file and are not rendered.
  Imports AdsEngineChart, Heatmap, Sparkline are unused in the live tree.

SHARED
  AppContext: dateRange, selectedProfileIds, selectedProfiles, primaryCurrency,
  adminFilterUserId, leftover royaltyRate (settings; not used in Overview finance).
  queries.ts seller reads; dashboardApi.ts Nest admin bootstrap.

UNCERTAIN
  None for the active route. Web “User dashboard” is a different client.
```

Tabs: Overview · Campaigns · Targets · Books · More.

### Live component tree

```text
OverviewScreen
├── Gates (full screen)
│   ├── Spinner — no selected profiles, profiles loading
│   ├── RetryState — profiles / admin users error
│   ├── EmptyState — no Amazon account
│   └── RetryState — admin bootstrap error and no cached data
├── Sticky header
│   ├── Account chip → /more/accounts + primaryCurrency tag
│   ├── Sync pill → /more/sync
│   └── Period navigator (prev / next + Month | Week) → setDateRange
└── FadeOnChange (key = profiles + date range)
    ├── Net profit card
    │   ├── Label “Net profit”
    │   ├── Verdict pill (Loading / No royalties / Ads unavailable / Profitable / Loss)
    │   ├── Net value or —
    │   ├── vs-prev delta (only if current + previous KDP ready)
    │   ├── NetProfitChart (net + royalties + spend) if KDP ready and ≥2 ads days
    │   └── Royalties / Spend / Margin
    ├── Top books (limit 4; privacy blur; not tappable)
    └── Spending without sales (keywords, spend>0 and ads orders=0, max 5) → /keyword/[id]
```

### Dual query pipeline

| Mode | Condition | Live queries |
| ---- | --------- | ------------ |
| Seller | `!adminFilterUserId && selectedProfileIds.length > 0` | `fetchCampaignMetricsRange` + previous; `fetchKdpRoyaltiesRange` + previous; `fetchTopBooksRange` (limit 4); `fetchProfileSyncLogs`; `fetchKeywords` (limit 40) |
| Admin | `adminFilterUserId && nestProfileIds.length > 0` | `fetchDashboardBootstrap` only. Mapped by `bootstrapToCampaignMetrics`, `bootstrapToRoyalties`, `bootstrapToTopBooks`, `bootstrapToBleeders`. Previous period from `metrics.previousMetrics`. |
| Disabled (`enabled: false`) | hook order | aggregated campaigns, yesterday / day-before, top campaigns, top books yesterday, placement mix, today metrics, budgets, rule executions, rules, today stats, hourly (last 7 calendar days), search-terms pulse, BidBot status |

`nestDashboardProfileIds` remaps App `amazon_profiles.id` → Amazon `profile_id` for Nest bootstrap. Seller Supabase reads use `amazon_profiles.id` on `campaigns.amazon_profile_id`.

---

## Metric dictionary

Visible labels only. Internal fields that are computed but not shown are noted as **not displayed**.

### Net profit

| Field | Value |
| ----- | ----- |
| UI label | `Net profit` |
| Internal field | `totals.net` |
| Query | Seller: KDP range + campaign_metrics. Admin: Nest bootstrap royalties + ads daily |
| Date window | `AppContext.dateRange` (Overview Month/Week stepper writes this) |
| Profile scope | `selectedProfileIds` (seller) / remapped `nestProfileIds` (admin) |
| Currency | `primaryCurrency` (plurality of selected profiles’ `currency_code`; default USD) |
| Aggregation | `royalties - spend` |
| Missing behavior | Loading → `—`. `!hasKdpData` or ads error → `—` + verdict `No royalties` / `Ads unavailable`. Verified KDP $0 with spend → numeric, can be negative. |
| Comparison source | Immediately preceding equal-length range via `previousRange`. Hidden if previous KDP not ready. `pctDelta`; baseline 0 → 0% (badge hidden when delta is 0). |
| Navigation | None |
| Confidence | **VERIFIED** |

Meaning: advertising contribution versus **imported KDP royalties**, not a full P&L. Excludes printing, Amazon fees beyond royalty, tax, and other costs. Product language overstates accounting “profit.”

### Royalties

| Field | Value |
| ----- | ----- |
| UI label | `Royalties` |
| Internal field | `totals.royalties` ← `royaltyRange.totalRoyalties` when `hasKdpData` |
| Query | Seller: `fetchKdpRoyaltiesRange` → `kdp_daily_data.royalties`, else `kdp_entries.income`, for KDP accounts linked via `kdp_account_amazon_profiles` (plus legacy `kdp_accounts.amazon_profile_id`). Admin: Nest `metrics.kdpRoyalties` / daily royalty points |
| Date window | selected `dateRange` |
| Profile scope | linked KDP accounts for selected Amazon profiles |
| Currency | labelled `primaryCurrency`; source values used as stored (no FX) |
| Aggregation | sum of daily royalty rows in range |
| Missing behavior | `hasKdpData === false` (no linked KDP, empty range, or failed seller query) → `—`. True zero with daily rows → `$0`. |
| Comparison source | previous-period KDP total (not shown as its own badge; only feeds net delta) |
| Navigation | None |
| Confidence | **VERIFIED** |

`AppContext.royaltyRate` is **not** applied to the hero. `fallbackRoyalties = (_sales) => 0` exists so Ads sales are never multiplied by a settings rate.

Seller `hasKdpData` = daily.length > 0. Admin `hasKdpData` = daily.length > 0 **or** `kdpRoyalties > 0`. Admin previous period: `hasKdpData` only if `kdpRoyalties > 0` (verified $0 previous KDP looks missing).

### Spend

| Field | Value |
| ----- | ----- |
| UI label | `Spend` |
| Internal field | `totals.spend` |
| Query | Seller: sum `campaign_metrics.spend` for campaigns in selected profiles. Admin: Nest `adsEngineDaily` (preferred) or `combinedDaily` |
| Date window | selected `dateRange` |
| Profile scope | all campaigns on selected profiles (no active-only filter) |
| Currency | labelled `primaryCurrency`; no FX |
| Aggregation | sum of daily campaign metric spend |
| Missing behavior | Loading or ads query error → `—`. Empty successful metrics → `$0` (no rows treated as zero activity). |
| Comparison source | previous-period spend (feeds net math; spend badge not shown) |
| Navigation | None |
| Confidence | **VERIFIED** |

### Margin

| Field | Value |
| ----- | ----- |
| UI label | `Margin` |
| Internal field | `profitMargin` = `safeDivide(net, royalties) * 100` |
| Query | derived from Royalties + Spend |
| Date window | same as hero |
| Profile scope | same |
| Currency | percent, not money |
| Aggregation | period totals, not average of daily margins |
| Missing behavior | loading, no KDP, or royalties === 0 → `—` |
| Comparison source | none |
| Navigation | None |
| Confidence | **VERIFIED** |

### Sales (Ads attributed) — not a hero label

Overview does **not** display a headline named `Sales`. Internally `totals.sales` is Amazon Ads attributed sales from `campaign_metrics.sales` / Nest ads daily `sales`. Used for ACoS, break-even ACoS, and unused engine-health helpers. **Not interchangeable with royalties or KDP gross.**

Book rows: `b.sales` = Ads attributed sales for that book group.

Bleeders title: `Spending without sales` — filter is `total_orders === 0` (Ads orders), not KDP sales. Terminology P1.

### Orders — not a hero label

| Use | Meaning |
| --- | ------- |
| `totals.orders` | Amazon Ads attributed orders (campaign_metrics / Nest ads daily) |
| `totals.bookOrders` | KDP `totalOrders` when `hasKdpData`, else Ads orders |
| `totals.organicOrders` | `max(0, bookOrders - ads orders)` when KDP present, else 0. **Not rendered.** Former `btOrganicOrders` series is gone. |
| Top books `b.orders` (seller KDP path) | KDP `kdp_book_daily_data.orders` |
| Top books `b.orders` (seller no-KDP fallback) | product_ad_metrics orders (Ads) |
| Top books `b.orders` (admin Nest) | `book.orders` from Nest — **UNCERTAIN** whether KDP units or Ads orders |
| Bleeders | Ads keyword orders in range (seller) or forced 0 on Nest zero-sales list (admin) |

Do not force Overview Orders to match Books or Campaigns. They are different grains. Books List / Book Detail already record parent/child order mismatch (backlog D20).

### ACoS

Not a hero number. Computed as **aggregate** `safeDivide(spend, ads sales) * 100` (`safeDivide(x,0)=0`). Not `average(campaign ACoS)`.

Shown on Top books: `b.spend / b.sales` when `b.sales > 0`, else `—`.

Zero Ads sales → internal ACoS 0; book row shows `—`.

### ROAS

Not shown on live Overview. Computed on Nest campaign mapper (`sales/spend`) and book rows (`b.sales / b.spend`, 0 if no spend). No Infinity/NaN on those paths (`safeDivide` / `spend > 0` guards).

### Break-even ACoS

Not a hero number. Hero-level value (used only by unused campaign-ranking / engine-health code):

```text
(royaltyPerBookOrder / adSalePerOrder) * 100
```

only if `hasKdpData` and both per-order values > 0. Otherwise 0 (“unknown”). **Not** an average of book break-evens.

Book rows: seller KDP path uses `breakEvenFromKdpTitle` from **all-time** KDP royalties/orders and **all-time** product-ad sales/orders (not the selected range). Fallback `effectiveRoyaltyRate` is 0 on Overview. Admin: Nest `breakEvenAcos` per book.

If Nest/book BE is missing: `—`.

### Top books · Net

| Field | Value |
| ----- | ----- |
| UI label | (unlabeled trailing money; `+` if ≥ 0) |
| Internal field | `b.net` = `b.royalties - b.spend` |
| Query | Seller: `fetchTopBooksRange` limit 4, sort by net desc. Admin: bootstrap `topBooks` |
| Date window | selected `dateRange` (royalties + ads in range). BE uses all-time (seller). |
| Profile scope | selected profiles / Nest remapped in bootstrap |
| Missing behavior | empty list → “No book data in range”. No-KDP seller fallback can invent royalties from `sales * (breakeven/100)` only if BE > 0; Overview passes rate 0 so royalties stay 0 and net = −spend. |
| Navigation | **None** (rows are not tappable; Books List is) |
| Confidence | **VERIFIED** for seller KDP path. Admin Nest orders field **UNCERTAIN**. |

### Spending without sales · Spend

| Field | Value |
| ----- | ----- |
| UI label | `{amount} spent` under keyword text |
| Internal field | `row.total_spend` |
| Query | Seller: `fetchKeywords` + range `keyword_metrics`. Admin: Nest `bleedingEntities.zeroSales` |
| Date window | selected `dateRange` |
| Profile scope | selected profiles |
| Filter | spend > 0 and Ads orders === 0; max 5 |
| Missing behavior | section hidden if none |
| Navigation | `/keyword/[id]` |
| Confidence | **VERIFIED** (Ads keyword spend). Label “sales” vs orders is P1 copy. |

### Sync pill

| Field | Value |
| ----- | ----- |
| UI labels | `OK` / `Issue` / `Syncing` / `Sync` / `Checking` |
| Query | `fetchProfileSyncLogs(selectedProfileIds)` — **seller only** |
| Date window | last 20 profile_sync_logs, no range filter |
| Admin | query disabled → typically `Waiting` / `Sync` |
| Navigation | `/more/sync` |
| Confidence | **VERIFIED** for seller. Admin freshness **DATA/FRESHNESS GAP**. |

### Currency tag

Displays `primaryCurrency`. Not a metric.

### Hidden / leftover (not user-visible)

Impressions, clicks, CTR, CVR, Ads sales, Ads orders, organic orders, yesterday pulse, budget pace, placement mix, heatmap, Action Review / Needs Attention list, campaign leaderboard, rule-run counts, BidBot status, `engineHealthLabel`. Computed in file; queries mostly disabled.

---

## Query lineage

### Royalties (seller)

```text
kdp_account_amazon_profiles (+ legacy kdp_accounts)
→ kdp_daily_data.royalties  (fallback kdp_entries.income)
→ fetchKdpRoyaltiesRange
→ royaltyRange.totalRoyalties / hasKdpData
→ totals.royalties (0 internally if !hasKdpData)
→ ProfitBreakdownItem “Royalties” (— if !kdpReady)
```

### Royalties (admin)

```text
GET /dashboard/bootstrap?startDate&endDate&profileIds&filterUserId
→ metrics.kdpRoyalties + kdpDailyRoyalties / netSeries / combinedDaily
→ bootstrapToRoyalties
→ same totals / display path
```

### Spend (seller)

```text
campaigns.amazon_profile_id IN selectedProfileIds
→ campaign_metrics.spend [start, end]
→ fetchCampaignMetricsRange
→ aggregateDailyMetrics
→ totals.spend
→ “Spend”
```

### Spend (admin)

```text
bootstrap.adsEngineDaily.data (else combinedDaily)
→ dailyPointsToMetrics
→ same aggregation
```

### Net profit

```text
totals.royalties - totals.spend
→ displayed only if kdpReady && adsReady
```

### ACoS (internal / book rows)

```text
safeDivide(spend, adsSales) * 100
```

### Top books (seller)

```text
kdp_book_daily_data (royalties, orders) by group_key
+ product_ad_metrics (spend, sales, …)
+ campaign_metrics for campaigns without product-ad metrics (name-inferred)
→ fetchTopBooksRange
→ Top books card
```

Books List uses the **same function** with `limit: 300` and query key `products-range`. Overview uses `top-books-range` and `limit: 4`.

Admin Overview uses **bootstrap.topBooks**, not `fetchTopBooksRange`. Admin Books List uses `fetchTopBooksRange` + Nest `fetchNestTopBooks`. Those can disagree.

---

## Date / profile scope

### Date-range table (live widgets)

| Widget | Date source | Actual range | Correct? |
| ------ | ----------- | ------------ | -------- |
| Net / Royalties / Spend / Margin | `dateRange` | Month: 1st → today or month-end. Week: end−6 → end, capped at today. Stepper writes shared `dateRange`. | Yes — labels via `formatDateRangeLabel` |
| vs-prev | `previousRange(start,end)` | Same day-count, immediately before start | Yes. Hidden if previous KDP missing. Timezone = device-local date-only. |
| NetProfitChart | ads daily dates in range | Days that exist in campaign_metrics / Nest ads daily. Missing calendar days are **omitted**, not invented. Missing KDP on an ads day → 0 royalties that day (only if `hasKdpData` overall). | Yes if understood; SUM(chart) ≠ headline royalties when KDP days ≠ ads days |
| Top books | `dateRange` | same. Seller BE all-time. | Yes; BE window differs (documented) |
| Bleeders | `dateRange` | same | Yes |
| Sync pill | last sync logs | not the P&L range | Yes — status, not a period total |
| Hourly heatmap (disabled) | last 7 calendar days | **not** selected range | N/A while disabled |

Overview Month/Week **overwrites** the shared `dateRange`. Campaigns / Books / Targets then use that same range. Intentional (closed P&L period vs list date sheet).

Default `AppContext` range is `rangePresets().thisMonth` until Overview stepper or date sheet changes it.

### Profile / account consistency

Live seller widgets all use `selectedProfileIds`. Live admin finance / books / bleeders all use bootstrap with remapped `nestProfileIds`.

No first-profile-only finance query. Sync logs ignore admin remapping (seller-only).

### Admin-filter consistency (live queries)

| Query | selectedProfileIds | adminFilterUserId | logged-in user id |
| ----- | ----------------- | ----------------- | ----------------- |
| fetchDashboardBootstrap | YES (as nest profile_id) | YES | NO |
| fetchCampaignMetricsRange | YES | NO (disabled when admin) | NO |
| fetchKdpRoyaltiesRange | YES (via KDP links) | NO (disabled when admin) | NO |
| fetchTopBooksRange (Overview) | YES | YES (sellerReady only; typically null) | NO |
| fetchKeywords bleeders | YES | YES (sellerReady only) | NO |
| fetchProfileSyncLogs | YES | NO | NO |
| fetchRuleExecutions / fetchOptimizationRules / fetchTodayExecutionStats | YES in key | NO | YES (`user.id`) — **disabled**, same class as D25 |
| fetchBidEngineStatus | NO | YES | — **disabled** |

---

## Currency semantics

- Label: plurality `currency_code` among `selectedProfiles`, else `USD`.
- Values: summed as stored. **No frontend FX. No backend conversion in these Overview paths.**
- Mixed-marketplace selection can present one total under one code.

Classification: **PRODUCT / DATA GAP (P1)**. Do not invent FX in UI. Not fixed this pass.

`formatCurrency` uses `toLocaleString` (device locale). Comma decimals are D8, not a mapping bug.

---

## Timezone integrity

- Range bounds are date-only strings (`YYYY-MM-DD`).
- `toDateString` / `parseDateOnly` use **device-local** calendar (`T12:00:00` parse).
- “Today” cap for Month/Week is device-local today.
- `campaign_metrics.date` and `kdp_daily_data.date` are date columns (Amazon report dates), not profile-TZ timestamps.

**DATA/TIMEZONE GAP (P2):** day boundaries may differ from Amazon profile timezone. Do not silently change timezone architecture.

---

## Charts

One live chart: `NetProfitChart`.

| Item | Reality |
| ---- | ------- |
| Purpose | Daily net (royalties − spend) with dashed royalty and spend overlays |
| Source | `aggregateDailyMetrics(metricRows)` dates. Royalties from `royaltyByDate` or 0 |
| Metric | net, royalties, spend |
| Granularity | day |
| Date range | ads days inside selected range |
| Timezone | date-only / device-local labels via `formatDateShort` |
| Missing-day behavior | day omitted if no ads row (not calendar-filled) |
| Filler behavior | **No demo/placeholder series.** No interpolation. No `Low CTR: check creatives`. Chart.tsx has no Overview filler generator. A missing KDP **day** inside a range that has KDP overall is drawn as 0 royalties (legitimate empty bucket, not fake revenue). |
| Empty | chart hidden if <2 ads days or `!kdpReady` |
| Total reconciliation | SUM(chart net) ≈ headline net only if every KDP day is also an ads day and every ads day royalty is in `royaltyByDate`. Otherwise headline KDP total can include days the chart never plots. |

Former `btOrganicOrders` / Ads Engine / Heatmap / Funnel are **not rendered**. Test 13 still expects `btOrganicOrders` in source — stale.

---

## Cross-screen reconciliation

### Headline ↔ chart

Legitimate differences:

1. Chart x-axis = ads daily points only.
2. Headline royalties = all KDP days in range.
3. Admin bootstrap drops $0-royalty days from daily map; those ads days chart as 0 royalties.
4. Admin previous period is a **single synthetic row**, not a daily series (does not affect the current-period chart).

### Books ↔ Dashboard

Comparable: royalties (same period, same profiles) **only if** both use the same grain.

- Overview royalties = account-level `kdp_daily_data` / Nest `kdpRoyalties`.
- Books / Top books = `kdp_book_daily_data` (ASIN/group) or Nest top-books.

These can differ (ungrouped account days, books without ASIN, Nest vs Supabase). **Do not force them equal.**

Comparable: book-level spend on Overview top-4 vs same books on Books List (same `fetchTopBooksRange` seller path). Totals of top 4 ≠ catalog spend.

Do **not** compare Overview royalties to Books Ads sales.

### Campaigns ↔ Dashboard

Comparable in principle: Ads spend, Ads sales, Ads orders — **same profiles and dateRange**.

Expected mismatches (not automatically bugs):

- Overview seller spend = **all** `campaign_metrics` for campaigns on selected profiles.
- Campaigns List = `fetchTopCampaignsRange` then hides paused-with-no-data / archived (`shouldShowActiveOrPausedWithData`), plus search/state filters.
- Admin Overview spend = Nest bootstrap ads daily. Admin Campaigns List = Nest aggregated entities with `selectedProfileIds` **not remapped** through `nestDashboardProfileIds`. ID-space mismatch is a **P1 query-scope risk** on Campaigns, not fixed here.
- Campaign Detail daily vs list rollup already D4.

Overview does not headline Ads sales or orders.

---

## Missing vs zero

| State | Display (after this pass) |
| ----- | ------------------------- |
| Finance loading | `—` for net, royalties, spend, margin |
| No KDP in range / no linked KDP / royalties query failed | Royalties `—`, Net `—`, Margin `—`, verdict `No royalties`, chart hidden. Spend still shows if ads ready. |
| KDP present, $0 royalties | `$0` royalties; net = −spend |
| Ads query error | Spend `—`, Net `—` |
| Ads success, no metric rows | Spend `$0` |
| Book ACoS, ads sales 0 | `—` |
| Book BE 0 | `—` |
| Top books empty | “No book data in range” |
| Bleeders none | section omitted |
| No profiles | empty / retry gates — no $0 P&L |

---

## Partial failures

- Admin bootstrap error + no data: full-screen Retry. Other widgets not shown.
- Admin bootstrap `partialFailures`, `cachedAt`, `stale` are **on the type and unused**.
- Seller: `loading = metricsQ.isLoading \|\| royaltiesQ.isLoading`. One source can finish first; `—` until both load.
- Seller royalties **error** (not loading): treated as no KDP → `—` for royalties/net (this pass). Spend remains if ads succeeded.
- Seller ads **error**: spend/net `—`; royalties can still show if KDP succeeded.
- Combined Profit is **not** shown unless both sources are ready.
- One profile failing inside a multi-profile Supabase `.in()` is not isolated; the query fails as a whole.
- Top books / bleeders / sync fail independently; they do not destroy the hero. Failed top books → empty state. Failed bleeders → hidden. Failed sync → “Waiting”/“Sync”.
- Pull-to-refresh refetches: bootstrap, metrics, prev metrics, royalties, prev royalties, top books, sync logs, bleeders. Disabled queries are not refetched.

Cache: `staleTime` 5 minutes (live BidBot cache 1 minute, unused). Refresh can leave a stale widget only if its refetch fails while others succeed.

---

## Data freshness

- Seller: sync pill from `profile_sync_logs` (Ads-oriented). KDP recency (`kdpStale`) is computed and **not shown** (dead Action Review).
- Admin: bootstrap `cachedAt` / `stale` unused. Sync query off.
- KDP and Ads can lag independently.

`DATA/FRESHNESS GAP` — users can read a current-looking P&L with stale KDP. Do not invent timestamps the backend does not expose on the seller path. Nest already has `cachedAt`; Overview does not surface it.

---

## Navigation map

| Control | Destination | Context passed |
| ------- | ----------- | -------------- |
| Account chip | `/more/accounts` | none (global profile selection lives in AppContext / that screen) |
| Sync pill | `/more/sync` | none |
| Period chevrons / Month\|Week | updates `dateRange` | shared with Campaigns / Books / Targets |
| Top books row | none | — |
| Bleeder row | `/keyword/[id]` | keyword id only; date/profile remain global |
| Needs Attention / Action Review | not rendered | leftover `actionItems` would have gone to rule-history, campaigns, sync |

No Search Terms, Campaigns, or Books CTA on the live Overview.

---

## Existing UI relevance (for NEXT visual pass)

**CRITICAL**

- Account + period context
- Net profit (with honest missing state)
- Royalties
- Spend
- Chart (when KDP exists)

**USEFUL**

- Margin
- vs-prev (when both periods have KDP)
- Top books (top 4 by net)
- Spending without sales
- Sync pill (seller)

**SECONDARY**

- Currency tag (duplicative with spend/royalty formatting)
- Privacy blur on top books
- Verdict pill (useful once missing vs profit/loss is distinct)

**REDUNDANT**

- Royalties + Spend + Net + chart all tell the same P&L story (acceptable if hierarchy is clear)
- Dead helpers / disabled queries (code redundancy, not UI)

**MISLEADING** (copy / semantics; data now gated)

- Label `Net profit` for `royalties − ad spend` (not full P&L)
- `Spending without sales` vs Ads **orders** === 0
- Admin sync pill without sync data
- Pre-fix: missing KDP as `$0` / `−spend` / `Loss` — **fixed this pass**

**DATA NOT TRUSTED**

- Mixed-currency totals under one code
- Admin previous-period KDP `$0` treated as missing
- Admin Overview top books vs Books List Nest path
- Admin book `orders` grain
- Unused Nest `partialFailures` / `stale`

---

## Charts / filler investigation (test 13)

Current Overview has:

- `adsEngineAcos` — still computed, **not rendered**
- `btOrganicOrders` — **removed** (organic orders remain as an unused number)
- `Low CTR: check creatives` — **absent**

No synthetic demo values. Test 13 is a **stale source-string test**, not proof of fake charts.

---

## P0 / P1 data issues

### P0 — resolved this pass

**UI PRESENTATION BUG:** missing KDP displayed as verified `$0` royalties and Profit = `−spend` / `Loss`.  
Fix: display `—` and hide the net chart unless `hasKdpData` and ads are ready. Formula still does not invent royalties from Ads × royalty rate.

### P1 — remain (documented; not safely fixable here)

1. **PRODUCT SEMANTICS GAP** — `Net profit` is royalties − ad spend, not accounting profit.
2. **PRODUCT / DATA GAP** — no FX; mixed currencies labelled as one total.
3. **FRONTEND DATA MAPPING** — admin `previousMetricsToRoyalties.hasKdpData` is `royalties > 0`, so previous $0 KDP looks missing (delta hidden after this pass; still wrong if we later show it).
4. **QUERY SCOPE** — Campaigns List Nest `profileIds` are not remapped like Overview bootstrap.
5. **PRODUCT SEMANTICS** — Overview royalties (account daily) vs Books (book daily) can disagree.
6. **PRODUCT SEMANTICS** — bleeder title says “sales”, filter is Ads orders.
7. **DATA/FRESHNESS GAP** — unused Nest `cachedAt`/`stale`/`partialFailures`; seller KDP lag not shown; admin sync pill empty.
8. **UNCERTAIN** — Nest top-book `orders` grain.
9. **FRONTEND DATA MAPPING** — seller top-books no-KDP fallback can set net = −spend (rate 0 avoids invented royalties, still looks like a P&L row).

### P2 / P3

- Device-local vs Amazon profile timezone (P2).
- Empty ads metrics displayed as `$0` spend (usually correct “no activity”).
- Chart omits KDP-only days (P2 reconciliation).
- Top books not tappable (P2 IA).
- Dead query/helpers (P3).
- `royaltyRate` still in AppContext / Settings (P3 leftover).
- Headline ACoS/ROAS/Orders not shown (P3 / next IA).
- D4, D8, D20 remain on other screens.

---

## Backend / product gaps

- No FX service on Overview totals.
- Nest bootstrap unused freshness / partial-failure fields.
- Admin previous KDP has no `hasKdpData` / orders.
- Dual seller Supabase vs admin Nest pipelines.
- Account-level vs book-level royalty grains.
- `entities` / rule activity not on Overview (do not merge this pass).
- Needs Attention exists only as dead `actionItems` (wasted spend, high ACoS, failed rules, budget, sync, KDP lag). Sources are mostly disabled. **Do not invent a scoring engine.** Availability: **AVAILABLE, NOT SURFACED** for bleeders (already a section); **BACKEND / query re-enable required** for campaign wasted-spend and rule failures; **NOT JUSTIFIED** to rebuild yesterday pulse / heatmap without a product brief.

### Missing high-value information (not implemented)

| Idea | Class |
| ---- | ----- |
| Honest missing-KDP state | done (presentation) |
| Biggest spend driver / worst book | AVAILABLE, NOT SURFACED (top books + bleeders already partial) |
| Needs Attention list | AVAILABLE, NOT SURFACED (dead `actionItems`) |
| Rule / BidBot activity on Overview | AVAILABLE elsewhere; do not merge this pass |
| Last-updated KDP vs Ads | BACKEND REQUIRED on seller; Nest `cachedAt` unused |
| FX-converted totals | BACKEND REQUIRED |
| Full P&L (print, fees) | BACKEND / NOT JUSTIFIED without cost data |

---

## Current first viewport (device evidence 2026-08-22)

Standard iPhone 17 (`overview-current-standard-light.png`, dark, largetype):

- First paint: sticky header (All profiles · USD · Sync · Aug 1–22 · Month) then Net profit card.
- First numbers: Spend `$0.00`. Royalties / Net / Margin are `—` with verdict `No royalties` (missing-KDP gate).
- Chart absent (no KDP).
- Next card: Top books empty (“No book data in range”).
- Bleeders hidden.
- Scroll burden: two cards; first actionable finance is the hero. Account chip and period stepper are tappable above the fold.
- Clipping: none on this empty/missing-KDP snapshot. Expo “Open debugger” toast overlaps the tab bar (D15, dev-only).
- Dynamic Type: `profitMetric` is a fixed StyleSheet size (`40` / weight `300`), so XXXL barely changes the hero. Next visual pass should wire headline type to the theme scale if operators need DT.

Small iPhone 16e (`overview-current-small-light.png`):

- Admin/Nest session did not transfer (same class as D17).
- First viewport is the no-profile gate: “No Amazon account” / “Nothing is linked to test@gmail.com.” / Connect account.
- First actionable control: Connect account. No metric cards. No clipping of the gate.

## Recommended UI hierarchy for NEXT pass

Do not start that pass from this audit automatically.

**P5 (keep first)**  
Account/period → Net (or a more honest “Royalties − spend” label) → Royalties / Spend → chart when KDP exists.

**P4**  
Top books (make rows open Book Detail; keep 4). Bleeders. Seller sync.

**P3**  
Margin, vs-prev, verdict. Optional: surface Nest `cachedAt` for admin only if copy is precise.

**P2**  
Do not re-enable heatmap, placement mix, yesterday pulse, Ads Engine, funnel, BidBot, or rule pulse without a separate IA decision. Remove or quarantine dead helpers in a cleanup pass.

---

## Tests

See workstream report. Do not rewrite assertions 6 / 13 merely to go green.

---

## Files in this workstream

- `frontend/app/(tabs)/index.tsx` — display gates + query-key hygiene
- `frontend/tests/data-mapping.test.js` — added missing-KDP display test
- `docs/ui-audit/IOS_DASHBOARD_DATA_AUDIT.md` — this file
- `docs/ui-audit/IOS_UI_PROGRESS.md`
- `docs/ui-audit/IOS_SCREEN_QA_MATRIX.md`
- screenshots under `docs/ui-audit/device-screenshots/` (`overview-current-*`)
