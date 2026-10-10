# InteliAds release qualification — 10 October 2026

Assessment time: approximately 12:40 Europe/Bucharest (09:40 UTC).

## Decision and scope

**Functional qualification: PASS** for Chrome 1.2.159, iOS 1.0.1 (388) and production 66434cd74781e349695a86ecf933e0e1c98d5201, for the cases listed below. **Unrestricted mass-distribution field certification remains HOLD** for the previously requested fresh physical blocked-second-gate → Bookshelf fallback → detailed recovery transition on candidate 388. No public store publication was performed.

The genuine-refund safeguard is functionally certified using the real SQL installed in production, executed in isolated PostgreSQL. An actual customer refund is not required to establish this transactional behavior and was not fabricated. The absence of a genuine refund in the live review queue is not relabeled as a passed live refund.

This document certifies observed behavior and executed tests. It does not certify absence of all future defects, fixed 15-minute iOS execution, continuous execution after force quit, or equivalence to Chrome's scheduling under every operating-system state.

## Verified cases

| Case | Result | Evidence type |
| --- | --- | --- |
| Chrome runtime/session persistence and natural sync on VPS1/VPS2/Windows | PASS | Original accounts preserved; runtime 159; natural successful syncs; no login/reset required |
| Chrome gate 403 retains blocked state, hourly cooldown/reprobe and successful recovery | PASS | Executed release-source policy/probe tests; no bypass of a real auth response |
| iOS blocked gate uses exact Live Bookshelf ASIN/setup price, keeps detail timestamp old, persists dirty retry, retries while detail is fresh, then fills USD/CAD when open | PASS | Actual candidate pricingSync.ts executed with controlled transport/storage boundaries; 39 targeted pricing/background tests passed |
| Bookshelf unchanged price does not rewrite repeatedly; identity/format read failure cannot write a price; ebook alias rejected | PASS | Executed iOS/Chrome tests; common economics source identical after import-path normalization |
| Real changed-price Bookshelf then detailed capture | PASS on earlier Windows 154 | Live Windows account: ASIN B0GS27WQBZ/setup 2RZKVQBNHD8, Bookshelf update 9 Oct 08:38:31 UTC, same exact setup calculator HTTP 200 and book_priced 08:39:24–25. Historical evidence, not relabeled as 159 or 388 |
| Fresh physical candidate blocked-gate transition | NOT OBSERVED | Current VPS1/VPS2 gate is open, dirty queue zero; controlled tests are not called a real blocked Amazon session |
| Suspicious positive → zero capture preserves accepted value and native facts | PASS | Real migrated SQL, isolated PostgreSQL; repeated zero capture retains review candidate; no automatic destructive overwrite |
| Genuine full-refund correction may legitimately become zero after verified admin review | PASS | Real migrated SQL executes acceptance atomically, retains previous snapshot/audit, validates admin/evidence and rollback |
| Repeated acceptance, stale candidate, unreconciled candidate, tenant spoof and client deletion rejected | PASS | Same SQL tests and deployed admin/API guards; eight SQL correction/format tests passed |
| iOS TestFlight 388 foreground and locked reports/pricing/retry/backfill | PASS in tested state | User-confirmed lock plus USB-C; automatic recoveries; complete locked pricing 140 rows/10 ASINs/14 markets/8 currencies; subsequent pricing recapture 12:15 Romania |
| Native KDP reports and accepted book/day totals | PASS | July 13–Oct 10: 90 revision-verified days ×17 Report markets, zero orders/KENP mismatches, zero royalty differences over $0.03 |
| Release-source and deployed financial SQL convergence | PASS | All six effective snapshot/staging/review/apply/audit functions match production after PostgreSQL whitespace normalization; normalized SHA256 values recorded separately |

## Source and package identities

- Production frontend/backend/AMS images: sha-66434cd74781e349695a86ecf933e0e1c98d5201; backend healthy; full CI 552 suites / 5,136 server tests passed.
- Chrome package: 1.2.159; ZIP SHA256 4b57e6fcedc5fd1cc681ae847b027390836a8d8e040160bdb3186608cc77ddd4; all 119 extension tests passed. Production Git revision contains the same ZIP. This is not a Chrome Store submission claim.
- iOS candidate: source 97af5aff, TestFlight 1.0.1 (388), physical/runtime build confirmed with user-confirmed TestFlight installation. PricingSync SHA256 156303b06a711a9286e66f036eeefd7a6187fbf2729b4f783a277c88af08c6c3 matches the archived source commit. No rebuild or downgrade was made for this audit.
- Six production-equivalent SQL definitions are tested in a disposable database. Only read-only inspection touched production; no customer correction, fake refund, credential transfer or profile reset was performed.

## Operating conditions

Chrome checks price gate/retry hourly while Chrome and the profile are running; preserved alarms resume after restart. Bookshelf fast pricing may update only the primary market with valid same-account economics. When costs, royalty tier, market/currency or exact identity are unavailable or inconsistent, detail remains pending; the system does not invent break-even values. Native Report marketplaces (17) and available print calculator marketplaces (14) are separate scopes.

The iOS helper combines BGAppRefresh, BGProcessing, silent push, foreground resume, single-flight work and persisted deferred days. Tested locked-device behavior includes successful reports and complete print pricing. Apple's scheduler can defer background tasks and pushes. A request every 15 minutes is a target; it is not a delivery/execution SLA. See [Apple background strategies](https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app) and [background push delivery](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app).

## Remaining field step

Observe a genuine blocked pricing gate on an existing authenticated candidate account. Verify the exact Live book's safe Bookshelf fallback, persisted dirty detail retry, preservation of old detailed values, and recovery at a later natural wake once Amazon opens the gate. Do not log out, delete the profile, change a customer's price, forge a refund, or weaken the gate merely to label this case passed.

The earlier blanket statement that a genuine production refund must be manufactured before any qualification was too strong. Transactional acceptance is now qualified by production-equivalent SQL execution. The fresh physical blocked-gate request remains separate and unfulfilled.
