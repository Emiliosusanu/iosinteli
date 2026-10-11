# TestFlight 388: follow-up to the 20:17 locked-screen test

Read-only production follow-up on 2026-10-10, Europe/Bucharest (UTC+3).

The native expiration marker at 20:23:26 did not prove that all pricing work was permanently canceled. The cloud subsequently recorded `KDP pricing: updated 10 books` at 20:30:11.430 and `Imported 2 days · priced 10` at 20:30:11.720, both from iOS build 388. No manual sync, app launch, push dispatch, or deployment was triggered for this readback.

The database independently confirms 140 positive pricing rows across 10 ASINs and 14 marketplaces, all updated after the user-reported 20:17 screen lock. Latest capture/update: 20:30:09.941. None of these rows lacks printing cost, net royalty, or break-even ACoS; none has a zero net royalty. The two recent report days were verified by producer `ios-1.0.1+388` with 17 marketplaces at 20:23:11 and 20:23:16.

This proves eventual persistence of this cycle's report and pricing results. It does not identify whether pricing continued through an outstanding native network operation, resumed execution, or another wake. Cloud activity alone cannot establish continuous screen-lock state. It also does not prove a blocked Amazon second gate or a universal 15-minute wake guarantee.

Evidence: `IOS_388_LOCKED_USB_2017_RECOVERY_2026-10-10.json`.

## Supabase CSV supplied at 20:09

The 44-row export spans October 9 17:39 UTC through October 10 16:59:30 UTC (19:59 local), and contains error/warning entries only. It cannot explain the later 20:23 expiration or establish a success rate.

- Native build 388: a 401 at 19:59 on page offset 7000 of `kdp_book_daily_data`. Its query matches `fetchKdpBooksForTargetingFilter` in `frontend/src/lib/queries.ts`, which scans historical daily evidence to enrich the targeting book filter. This is an authenticated read, not a KDP report/price write. The error body is absent, so expired JWT versus another authorization cause remains undetermined. `fetchOptionalInPages` logs and suppresses failed chunks; a failed chunk can therefore omit filter enrichment. No same-page authorization recovery is present in this pagination path.
- Native build 386: a historical `kdp_book_daily_data` read timed out. Later 388 evidence must be evaluated separately.
- Node requests: repeated keyword reads/RPCs timed out (`57014`); a keyword metrics upsert encountered a lock timeout (`55P03`). The export does not contain their subsequent retries or successful results.
- Four report queue 409 responses pair with duplicate active-job constraint errors (`23505`, `uq_report_queue_active_profile_type`). Server source handles this race as an already-active job. These are not evidence of four lost reports.
- Missing relations, a nonexistent pricing-plan column, and a SQL syntax error require attribution to their callers; a Node user agent alone does not distinguish a production path from a diagnostic query.

No financial rows, credentials, profiles, or production behavior were changed during this inspection. Full mass-release certification remains subject to the existing unproven release cases.
