# Amazon Ads ACoS contract

Product reference: the production InteliAds **web** North Star dashboard.
Source of truth is the code paths below, not a new mobile definition.

Do not write `ACOS WEB/IOS PARITY: PASS` until the same user, profiles,
currency, and date window produce the same displayed ACoS on web and iPhone
(display rounding only).

Smart Home / Today / 7D / ACoS alerts stay blocked until that pass.

## Definition

Amazon Ads ACoS for the selected scope.

Not KDP royalties, profit, book revenue, organic sales, orders, or CPC.

## WEB SOURCE

`DashboardNorthStar`
→ `GET /dashboard/bootstrap` (metrics section)
→ `DashboardService.getDashboardMetrics` / `getMetricsForPeriod`
→ `campaign_metrics` (`spend`, `sales`, `orders`)
→ fallback `product_ad_metrics` only when campaign spend **and** impressions are both 0

Persist path: `amazon-sync.service.ts` `syncCampaignMetrics`

- `spend` ← Amazon `spend` (cost)
- `sales` ← Amazon `sales14d` (14-day attributed ad sales)
- `orders` ← Amazon `purchases14d`

Reporting window is Amazon’s persisted 14-day attribution. Do not reconstruct
attribution on the client.

## WEB FORMULA

```ts
const avgAcos = totals.sales > 0 ? (totals.spend / totals.sales) * 100 : 0;
```

The API field is named `avgAcos`. It is **not** an average of campaign ACoS
percentages.

## WEB NUMERATOR

`SUM(campaign_metrics.spend)` over the selected campaigns and `date` range.

## WEB DENOMINATOR

`SUM(campaign_metrics.sales)` where `sales` is persisted `sales14d`.

Amazon Ads attributed sales. Not royalties.

## WEB AGGREGATION

**A) `SUM(spend) / SUM(ad attributed sales)`**

Not `AVG(individual campaign ACoS)`.
Not a weighted average of daily ACoS percentages.

Entity tables (keywords, targets, campaigns) use the same ratio of that
entity’s summed spend and sales.

## WEB ZERO-SALES

Account KPI (`AdsKpiStrip`): server returns `0`; UI shows `0.0%` via
`acos.toFixed(1)`.

Today / Yesterday ribbon (`PerformanceCompareBand`): `null` → `—` when
that day’s ad sales are 0.

Those two surfaces already differ on web. Account KPI is the release
reference for Overview ACoS.

## WEB DATE SEMANTICS

`client/src/components/dashboard/north-star/periodUtils.ts` `computeRange`

- Month: local `startOf('month')` → local `endOf('month')` (full calendar month)
- Week: local ISO week Monday → Sunday (`startOf('isoWeek')` + 6 days)
- Custom: stored start/end
- Clock: **browser local timezone** (`dayjs()`), not a forced UTC or profile TZ
- Filter column: `campaign_metrics.date` (Amazon report date as stored)
- North Star has **no** first-class Today mode on the Ads KPI
- Unused API default (no dates sent): last 7 days excluding today, UTC
  `toISOString()`. North Star always sends dates, so the UI does not use this.

iOS `normalizeDateRange` caps `end` at today. For the current month/week,
future days are empty, so ACoS matches web’s full-period request.

## WEB PROFILE SCOPE

TopBar-selected **enabled** profiles.

IDs are Amazon Ads `profile_id`, which is also `amazon_profiles.id` and
`campaigns.amazon_profile_id` in production.

Campaign set: `user_campaigns` pivot first; if empty, all campaigns under
the selected profiles. Includes historical/paused campaigns that have
metrics in range. No extra “enabled campaigns only” filter on the KPI.

## WEB CURRENCY

Web may select mixed-currency profiles.

`useProfileMoney` still **sums raw amounts** and formats as USD when mixed.
No FX conversion.

iOS forces a single currency on the selected set. Do not add silent FX.
If the QA set is one currency, this is not the mismatch.

## WEB ROUNDING

Account KPI: `Number(avgAcos).toFixed(1)` → `37.64` displays `37.6%`.

Keyword persist path rounds `total_acos` to 2 decimals. Do not use that
for the account KPI.

## iOS (seller Overview)

`app/(tabs)/index.tsx`
→ `fetchCampaignMetricsRange`
→ Supabase `campaigns` by `amazon_profile_id`
→ `campaign_metrics` for the date range
→ `safeDivide(SUM(spend), SUM(sales)) * 100`

Same ratio as web. No `product_ad_metrics` fallback.

After this contract:

- Overview **Week** uses the web ISO week (Monday–Sunday), not rolling last 7
- Overview account ACoS shows `0.0%` when sales are 0 (web KPI), not `—`
- Home **Today / 7D** uses the same spend÷sales ratio, Ads orders only
- Home **7D** is rolling last 7 local days (`HOME_SEVEN_DAY_CONTRACT = rolling_7d`)
- Overview **Week** remains ISO Monday–Sunday and is a different control

## HOME TODAY / 7D

Built from `campaign_metrics` (Nest `/dashboard/mobile` when present).

```ts
sales > 0 ? (spend / sales) * 100 : null
```

Zero-sales Today/7D ACoS is `—`, not web KPI `0.0%`. Do not display `7D`
while calculating ISO week.

## ALERTS

Frozen until `ACOS WEB/IOS PARITY: PASS`.

- iOS `runAlertCheck` is a no-op
- Daily report must not say ACoS up / down / high ACoS
- Month-to-date vs last-month-same-days is **not** the web previous-period
  window (web uses equal-length previous range from the selected dates)

## FRESHNESS / PARTIAL SYNC

Compare `data_as_of` / last successful sync before calling the formula
wrong.

Do not present an account ACoS as complete when a selected profile is
pending, failed, partial, or stale.

## TREND / MONTH COMPARE

When re-enabled: each period’s ACoS is `SUM(spend)/SUM(sales)` for that
period’s raw totals. Do not average daily or campaign percentages unless
web is later proven to do that (it does not today).
