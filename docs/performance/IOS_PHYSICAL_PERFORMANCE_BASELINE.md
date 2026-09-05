# iOS physical performance baseline

Physical timings require a Release build on iPhone 17 PRO Emiliano.
That device was `unavailable` at baseline. Numbers below are from the
Overview query graph. Do not write `INTELIADS PHYSICAL PERFORMANCE: PASS`.

## Query graph (seller Overview)

TOTAL HOME QUERIES declared: **25** `useQuery` hooks in `app/(tabs)/index.tsx`.

DISABLED (still mounted): 7  
`yesterday`, `dayBefore`, `yestRoyalties`, `dayBeforeRoyalties`,
`topBooksYesterday`, `hourly`, `searchTermsPulse`.

ENABLED after snapshot (P0+P1+P2+P3 together): **16**

| Phase | Queries | Gate today |
| --- | --- | --- |
| P0 | `mobile-overview`, `campaign-metrics`, `kdp-royalties` | `sellerAfterSnapshot` |
| P0 extra | `top-books-range`, `bleeders`, `sync-logs` | same as P0 — **too early** |
| P1 | `campaign-metrics-prev`, `kdp-royalties-prev` | same as P0 |
| P2 | rules, rule-execs, today-stats, bidbot | `sellerSecondary` (after metrics fetched) |
| P3 | top-campaigns, placement-mix, today-metrics, budgets | `sellerSecondary` |

INITIAL NETWORK REQUESTS (cold, empty memory, seller):  
1 snapshot, then a **burst of ~8**, then **~8 more** after metrics land.

DUPLICATE RESOURCES  
Campaign metrics fetched for range, previous range, and today.  
Royalties fetched for range and previous.  
Books fetched at Home even though Books tab has its own query.

WATERFALLS  
`snapshotQ` → `sellerAfterSnapshot` → metrics/royalties/books/bleeders/sync  
→ `metricsQ.isFetched` → campaigns/placement/rules/bidbot.

SERIAL DEPENDENCIES  
Home waits on snapshot **or** error before Ads range queries. That is correct
for auth scope. It is not correct that books/rules/campaign lists share that
gate.

EXPENSIVE DERIVATIONS  
Daily aggregation, break-even, campaign filters, book rows all run in the
Overview function body on every render. No profiler capture this pass.

## Persist

`queryPersist` keeps many range queries for 6h but **does not persist**
`mobile-overview`. Home snapshot has its own AsyncStorage helper. Cold open
can still miss the compact Home model.

`staleTime: 5m` is in-memory only. It is not Smart Cache.

## Motion / battery

`FadeOnChange` replays opacity+translate on every `dashboardTransitionKey`.
`onRefresh` refetches ~16 queries at once.
No 5-minute local business-alert interval (already removed).
`runAlertCheck` is a no-op.

## Physical timings

| Metric | Before |
| --- | --- |
| COLD → shell | not measured |
| COLD → cache | not measured |
| COLD → fresh | not measured |
| WARM RESUME | not measured |
| TAB SWITCH | not measured |
| TODAY→7D | not measured (should be local state) |
| HOME REQUEST COUNT | 16 enabled seller queries |
| HOME RENDER COUNT | not profiled |

Re-measure on device after the first performance pass.

## Source after first correction pass (2026-08-25)

Not physical. Do not write PERFORMANCE PASS.

ENABLED immediately (seller P0): **4**
`mobile-overview`, `campaign-metrics`, `kdp-royalties`, `sync-logs`

ENABLED after first interactions (P1/P2/P3): previous metrics/royalties,
top books, bleeders, then `sellerSecondary` lists (campaigns, placement,
today metrics, budgets, rules, execs, today-stats, bidbot).

DISABLED (still mounted): 7 (unchanged).

`onRefresh` refetches P0 only until below-the-fold is ready.

Persist:
- `mobile-overview` is in `PERSISTED_QUERY_KEYS`
- dedicated AsyncStorage snapshot + in-memory `peekMobileHomeSnapshot`
- hydrate still starts after first paint (shell is not blocked)

Motion:
- `FadeOnChange` removed
- tab `animation: "none"`
- value text uses `motion.interactionFast` / `motion.contentUpdate` and Reduce Motion

## Source after core-blocker pass (2026-08-26)

Home Today/7D no longer waits on missing `GET /dashboard/mobile`.
Seller metrics start with `sellerReady` (not snapshot success).
`campaign_metrics` and targeting metrics paginate past the 1000-row cap.
Books can paint core royalty rows before Ads enrichment.
Splash brand hold is 400ms and does not wait for dashboard network.

Physical timings still require a fresh Release on iPhone 17 PRO Emiliano.
Do not write `INTELIADS PHYSICAL PERFORMANCE: PASS` from this file.
