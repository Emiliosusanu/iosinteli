# InteliAds iOS release certification

This file is the versioned release ledger for the iOS app. A build is ready only
when every item assigned to that build is verified or explicitly marked as
blocked with evidence. New release work starts from `feat/ios-release-candidate`,
never from `main`, and never from the active Cursor checkout.

## Build 339 — uploaded, Apple processing

- [x] Latest release-candidate integration preserved.
- [x] Placement detail includes Orders and daily campaign chart includes Clicks.
- [x] KDP helper restores the saved session before asking the user to sign in.
- [x] KDP + Ads grouping, KDP rename, books detail, Ads-only definition, and marketplace flag spacing included.
- [x] 956 unit tests and TypeScript passed before archive.
- [x] Clean native archive created at `/tmp/InteliAds-339.xcarchive` and uploaded.
- [ ] Device UI smoke remains blocked by the iOS 26 remote-debug launch service; installation succeeded.

## Build 340 — controls, AI honesty, finance trend

- [x] Campaign Keywords show Active/Paused controls and labeled metrics.
- [x] Campaign Product targets and Auto targeting show Active/Paused controls and labeled metrics.
- [x] Paused campaign children remain visible so they can be resumed.
- [x] AI provider failure never auto-selects or presents Amazon rows as filtered.
- [x] Add Keywords selection remains empty until filtering succeeds or the user explicitly chooses unfiltered Amazon suggestions.
- [x] Gross, Net, and Ad Spend trend points share the same calendar dates and preserve missing-data semantics.
- [x] Focused unit tests pass.
- [x] Full unit suite (962 tests) and TypeScript pass.
- [x] Clean build 340 archive contains the expected Overview stadium chrome.
- [x] Build 340 installed over the existing app on the iPhone 14 Pro without deleting local data.
- [x] Physical iPhone 14 Pro launch succeeded through the native developer tunnel; Overview shows the certified stadium chrome, preserved session, Gross, Net, Ad Spend, and aligned trend.
- [x] TestFlight upload accepted by App Store Connect.
- [ ] Apple processing completed and build 340 visible in TestFlight.

## Build 341 — KDP Manager and live mutation certification

- [x] Starts from the exact merged build 340 release-candidate commit; the active Cursor checkout remains untouched.
- [x] Dedicated KDP Manager lists every account, including accounts with no Ads link.
- [x] Catalog reads combine KDP titles and formats so missing cover enrichment cannot hide a real book.
- [x] Each book shows every linked Ads marketplace sharing its ASIN.
- [x] Account rename and book detail are reachable from Settings.
- [x] Book deletion requires explicit destructive confirmation and preserves Amazon Ads entities.
- [x] Server deletion is one owned transaction and rebuilds affected Gross/Net source rollups.
- [x] Overview queries are invalidated after deletion; no stale financial total remains on screen.
- [x] Campaign AI filtering has production provider fallback across xAI, Groq, and OpenAI, strict Groq JSON Schema output, and fails closed when every provider fails.
- [x] Server PR #598 merged, production deploy passed, and the owned delete endpoint returns the expected authorization guard without deleting a live book.
- [x] Full iOS unit suite (968 tests) and TypeScript pass.
- [x] Physical iPhone 14 Pro smoke: campaign creation, ad group creation, add keywords, add products, AI filtering, keyword/product/auto controls, and KDP Manager. Production certification created campaign `175315280777532` and ad group `49109730195577` paused; readback shows one keyword and one product ad. The exact 120+80 phrase AI batches both returned 201, and device Campaign Creation/Add Keywords showed filtered selections without an unavailable fallback.
- [x] Clean build 341 archived at `/tmp/InteliAds-341.xcarchive`, installed over the existing app without removing local data, and accepted for TestFlight processing.

## Build 342 — honest large-profile sync freshness

- [x] Starts from the merged build 341 release candidate; the active Cursor checkout remains untouched.
- [x] iOS active-sync freshness now matches the server's 120-minute worker ownership window instead of labeling a valid large-profile hourly run stale after 45 minutes.
- [x] Live `emisusanu98` evidence captured the original mismatch: five profiles completed while the large profile remained legitimately pending at 59 minutes.
- [x] Boundary coverage verifies active at 119:59, stale after 120:00, and completed runs never stale.
- [x] Full iOS unit suite (969 tests) and TypeScript pass.
- [x] Clean build 342 archived at `/tmp/InteliAds-342.xcarchive`; bundle `io.inteliads.app`, version `1.0.1 (342)`.
- [x] Build 342 installed on the physical iPhone 14 Pro with the signed-in session and financial data preserved. The false Stale badge disappeared while Gross `$33.86`, Net `$16.04`, Ad Spend `$17.82`, Clicks `17`, and Orders `1` stayed unchanged.
- [x] App Store Connect accepted the build 342 upload and began processing it.

## Build 343 — KDP book navigation

- [x] Starts from the exact merged build 342 release candidate; the active Cursor checkout remains untouched.
- [x] Books in the dedicated KDP Manager open the canonical `/product/[asin]` detail using the real ASIN, title, and cover.
- [x] Books in the profile KDP-account popup open the same product detail and close the popup before navigation.
- [x] The dedicated manager keeps book deletion as a separate destructive action, so opening a book cannot delete it.
- [x] Regression coverage verifies both navigation surfaces and their real route parameters.
- [x] Full iOS unit suite (969 tests) and TypeScript pass.
- [x] Clean build 343 archived at `/tmp/InteliAds-343.xcarchive`; executable SHA-256 `c37e7db397939f042f8cb12e3a5af544318af30aec1a272402a2a97f9afacfba`.
- [x] Build 343 installed in place on the physical iPhone 14 Pro, preserving the signed-in session.
- [x] Live device verification opened real ASIN `B0F1G3QVF5` and rendered its canonical title, cover, KDP royalties, Ads spend, Net, impressions, clicks, orders, and five campaigns from production data.
- [x] App Store Connect processed build 343 successfully; status is `Ready to Submit` and the `Intelyads` TestFlight group is attached.

## Build 344 — KDP Manager navigation and Ads-scoped Targeting

- [x] Starts from the exact merged build 343 release candidate; the active Cursor checkout remains untouched.
- [x] Fixes the iOS nested-modal defect that made the KDP-account `Books` button appear inactive.
- [x] Dismisses the profile picker before opening KDP Manager and preselects the requested KDP account.
- [x] Home exposes KDP Manager from Top Books for account, marketplace, and book inspection.
- [x] Targeting keeps its profile selector Ads-scoped and no longer displays the KDP-account grouping.
- [x] KDP Manager shows each real book, opens canonical book detail, and requires confirmation before removing its KDP pricing, royalties, orders, and KENP data; Amazon Ads entities stay unchanged.
- [x] Live freshness verification confirmed that `Mary KDP` recovered from a genuine KDP-ingest gap with a new write at `2026-10-01 17:12:26 UTC`; both linked Ads profiles completed at `17:10 UTC`.
- [x] Full iOS unit suite (970 tests), TypeScript, and diff validation pass.
- [x] Clean build 344 archived at `/tmp/InteliAds-344.xcarchive`; executable SHA-256 `bd4857d55ab5a57cda1b1cb2f75ba29292049f820304361be917ebcc7bfb8227`.
- [x] Build 344 installed in place on the physical iPhone 14 Pro with the signed-in session preserved.
- [x] Physical-device evidence shows current Home financials and orders, the requested KDP account with real books and delete controls, and functional Targeting metrics and mutations. No InteliAds JavaScript error, crash, RedBox, or book-read error appeared in the device smoke log.
- [x] App Store Connect accepted the build 344 upload and began processing it.

## Build 345 — exact KDP scope and complete campaign creation

- [x] Starts from merged build 344 plus PRs #48 and #49 on `feat/ios-release-candidate`; the active Cursor checkout remains untouched.
- [x] KDP Manager reads each KDP catalog by its exact `account_id`, separates advertised-only ASINs, shows linked marketplaces, exposes duplicate-account evidence, and never deletes Ads entities.
- [x] Live account detail and canonical product navigation open on the physical iPhone 14 Pro. Real ASIN `B0F3JYJ9MT` rendered its title, cover, financial data, and campaigns.
- [x] The live overlap audit found historical shared ASINs across KDP accounts. No automatic deletion or guessed reassignment was performed; cleanup remains an explicit account-and-ASIN action.
- [x] KDP helper account switching preserves the InteliAds session, rejects account-mismatched captures, prunes only after a complete non-empty account snapshot, and leaves partial or empty captures untouched.
- [x] US and CA campaign creation loaded real Amazon keyword and product suggestions with metadata. US returned 546 keywords and 128 metadata-complete products; CA returned 576 keywords and 71 metadata-complete products.
- [x] Existing ad-group flows completed with AI-selected data: Keywords kept 87 of 600 match rows; Products evaluated 235 ASINs / 470 Exact+Expanded rows and kept 34, with real title, subtitle, cover, and bid data.
- [x] Live write certification remains paused-by-default and already covered US and CA campaign creation, keyword insertion, and product-target insertion without an invented fallback.
- [x] Focused release checks passed (183 tests); full iOS suite passed (971 tests) together with TypeScript.
- [x] Clean archive `/tmp/InteliAds-345.xcarchive` is `io.inteliads.app` version `1.0.1 (345)`; archive SHA-256 is `491e8a6e1dbeeb0222a407cf5eb69684cb818afe1cd1117af7f9c4decaa34a34`.
- [x] Build 345 installed in place on the physical iPhone 14 Pro with the signed-in session preserved, and App Store Connect accepted the upload.
- [x] App Store Connect shows build 345 as `Testing` in the internal `Intelyads` group after processing completed on October 2, 2026.
- [x] Server PR #604 deployed at merge `21d3b7c` with green production CI and health checks. Delivery tests prove that each new-order notification uses the complete current-day order total across all enabled Ads profiles, includes unchanged profiles, omits invalid cross-currency money totals, and retries instead of sending a partial total. No synthetic live order was created for certification.

## Build 346 — Search Terms global page candidate

- [x] Starts from the exact merged build 345 release candidate; the active Cursor checkout remains untouched.
- [x] Search Terms no longer waits for a full account-wide PostgREST scan before first paint.
- [x] Selected profiles, date range, text search, converting/no-order filters, and every metric sort execute on the complete server scope before pagination.
- [x] ACoS, orders, spend, clicks, and impressions sort high-to-low globally; subsequent pages preserve server order and exact total count.
- [x] Missing ACoS is labeled `N/A`, never rendered as a fake value or bare dash.
- [x] Search Terms has a finite 20-second terminal timeout and a retry path instead of an indefinite spinner.
- [x] Release stress scripts validate the current nullable KDP contract, current Targeting scope name, the installed app version, and the shared device runtime.
- [x] Server Search Terms tests, server build, iOS TypeScript, full 972-test suite, and tab stress audit pass.
- [x] Server migration `20261002083000_mobile_search_terms_global_page.sql` deployed once with release `64ba2c9`; backend, frontend, and worker report the same SHA and healthy state. Live `emisusanu98` reads covered 19,674 terms plus US/CA scopes, converting, wasted, text search, five metric sorts, and the page 1→2 boundary. Warm responses measured 0.27–1.13 seconds; the first cold request measured 3.11 seconds. Every response was HTTP 200 and globally monotonic.
- [x] Clean archive `/tmp/InteliAds-346.xcarchive` is `io.inteliads.app` version `1.0.1 (346)`; executable SHA-256 is `e896cabcbc02742c50dd1725ee8994770295bf0b8a47be92c34df3560cff623a`.
- [x] Build 346 installed in place on the physical iPhone 14 Pro with its signed-in session preserved. Overview rendered live Gross `$168`, Net `$77.46`, Ad Spend `$90.50`, ACoS `30.3%`, and Margin `46%`.
- [x] Device visual review found the two-day x-axis labels overlapping because the final label anchored back over the first one. Build 346 was therefore not uploaded and is superseded by 347.

## Build 347 — short-range chart labels and final device audit

- [x] Starts from the exact merged build 346 release-candidate commit; the active Cursor checkout remains untouched.
- [x] Every daily chart uses the same edge-aware date-label rule: compact ranges use available trailing space, while full ranges retain the right-edge anchor.
- [x] Regression coverage verifies both the two-day compact case and the full-month case.
- [x] Full iOS unit suite (973 tests), TypeScript, diff validation, and tab stress audit pass.
- [x] Clean archive `/tmp/InteliAds-347.xcarchive` is `io.inteliads.app` version `1.0.1 (347)`, preserves `/tmp/InteliAds-346.xcarchive`, and has executable SHA-256 `523fcc000f1f7fd0e9a26329d8ba4a9132d3dc4146615df2aeeca7d7fbd2b226`. The App Store export is production-signed with APNs production entitlement and IPA SHA-256 `38ad69b3a248110204347beb6d3e39f72f4cebb71e9348e7f0c1a2096d81318c`.
- [x] Build 347 was not installed or uploaded. A suggestion-selection count defect was found before release, so the archive remains preserved and is superseded by build 348.

## Build 348 — exact campaign target selection

- [x] Starts from the exact merged build 347 release candidate; the active Cursor checkout and its local edits remain untouched.
- [x] Create Campaign, New Ad Group, and Add to Existing Ad Group no longer preselect Amazon or AI suggestions. Zero user selections produce zero suggested targets.
- [x] Visible selection, total selection, custom entries, existing entities, duplicate identities, and the Amazon request use the same eligible keyword/product identity set.
- [x] Existing keywords and product targets are excluded before selection; async entity reads cannot leave stale hidden selections in the displayed count or payload.
- [x] Filtered selections disclose how many remain outside the current filter and provide an explicit Clear action.
- [x] Add-to-existing results report the confirmed Amazon count against the exact submitted count instead of implying that every selected row succeeded.
- [x] TypeScript, lint with zero errors, the full 977-test suite, and tab stress audit pass.
- [x] Clean archive `/tmp/InteliAds-348.xcarchive` is produced from the merged release candidate without overwriting build 347. It is `io.inteliads.app` version `1.0.1 (348)` with executable SHA-256 `c1d1b602f0046840b8baa71ea017e8f66e2a5bac011f00710f6ed0fb488dcbdc`; its App Store export is signed by `Apple Distribution: Emilian Susanu (AQ5FWX4K8Y)`, has the APNs production entitlement, and IPA SHA-256 `0f6d54dcb0afd19d10be4b10fc4dd462c0998b2a278bf9e8f00c4b86fe6a934b`.
- [x] Build 348 was not installed or uploaded. A manual Product Target could be a valid legacy ten-character ASIN that does not start with `B0`; build 348 rejected it, so the archive remains preserved and is superseded by build 349.

## Build 349 — legacy Product Target ASINs

- [x] Starts from the merged build 348 release candidate and preserves the active Cursor checkout and its local edits.
- [x] Pasted Product Targets accept both modern `B0` and legacy ten-character Amazon ASINs, while rejecting malformed values and retaining deduplication and exact request-count validation.
- [x] TypeScript, the full 977-test suite, and tab stress audit pass.
- [x] Clean archive `/tmp/InteliAds-349.xcarchive` is `io.inteliads.app` version `1.0.1 (349)` with executable SHA-256 `12af0828698d964ece4d4a3eeb158a544a1bca8f831064474e1c47b16791d7e5`; its App Store export is signed by `Apple Distribution: Emilian Susanu (AQ5FWX4K8Y)`, has the APNs production entitlement, and IPA SHA-256 `aa041e7d1f44b008ccc672d4d536991630d7a1c1448e154e162d57af711d911e`.
- [ ] Build 349 is installed in place on the iPhone 14 Pro; campaign, ad-group, keyword, and product-target selection counts match confirmed Amazon writes with the session preserved.
- [ ] App Store Connect accepts and processes build 349.

## Build 351 — KDP account integrity and durable helper session

- [x] Starts from the exact build 349 certification commit in the isolated `codex/ios-kdp-integrity` worktree; the active Cursor checkout remains untouched.
- [x] The iPhone KDP helper uses an explicit owned KDP account as its import destination. Ads profile and marketplace filters cannot switch that destination, and ambiguous account resolution fails closed until the user chooses an account.
- [x] KDP format rows define the current catalog after a full import; title rows only enrich title and cover metadata. Legacy accounts without format rows keep their title catalog.
- [x] Historical cross-account ASIN overlaps are quarantined to one visible owner instead of being deleted or displayed in several KDP accounts. The live audit found 17 historical overlapping ASINs and no overlap left visible in more than one account.
- [x] KDP Manager card totals come from the same authoritative, quarantined catalog shown in account detail. Live counts are 17 for `emi usd 2`, 24 for `vp Test 1`, 24 for `VP 2`, and 18 for `Mary KDP`.
- [x] Book rows open canonical product detail and keep destructive KDP-data deletion as a separate confirmed control. A physical-device read opened ASIN `B0F3JYJ9MT` with its real cover, September royalties, Ads spend, Net, impressions, clicks, orders, and campaigns.
- [x] Native WebKit cookie-store access preserves HttpOnly Amazon KDP cookies for background replay. A generic HTTP 403 no longer falsely destroys the saved session; a real 401 or Amazon sign-in redirect does.
- [x] The helper retries one transient capture failure once and keeps account-specific coverage/deferred state from leaking across a deliberate account switch.
- [x] TypeScript, diff validation, focused KDP coverage, and the full 980-test suite pass.
- [x] Clean Release archive `/tmp/InteliAds-351.xcarchive` is `io.inteliads.app` version `1.0.1 (351)` with executable SHA-256 `7e0fe0d6b0177e6e9eeade8d4cd28b320feab1a4e4f131b6fd9eaf80613c2dc0`. Its App Store export is signed by `Apple Distribution: Emilian Susanu (AQ5FWX4K8Y)`, has production APNs and `get-task-allow=false`, and has IPA SHA-256 `ea30485004ea264c467b3623fe74ec2ef61c43657716a2eb068a631e0326be09`.
- [x] Build 351 is installed in place on the physical iPhone 14 Pro with the signed-in session preserved. Overview shows Gross `$5.2K`, Net `$2,366.13`, Ad Spend `$2.9K`, ACoS `36.5%`, and Margin `45%`; KDP Manager and two isolated account catalogs render without a JavaScript exception, crash, RedBox, or book-read error.
- [x] Implementation commit `d3c7bdf9` merged through PR #58 at release-candidate commit `a31867e3`. App Store Connect processed build 351 successfully; its status is **Testing** in the internal **Intelyads** group as of October 3, 2026.

## Build 352 — exact suggestion selection and bounded AI recovery

- [x] Starts from the exact merged build 351 release candidate in the isolated iOS worktree; the active Cursor checkout remains untouched.
- [x] Create Campaign, New Ad Group, and Add to Existing Ad Group store selected targets by stable `keyword + match type` or `ASIN + match type` identity. AI ranking, metadata enrichment, filters, and existing-entity reads cannot move a checkmark to another row.
- [x] The displayed selected count and submitted Amazon payload are derived from the same current eligible identities; a fresh or refreshed suggestion result starts with zero selected rows.
- [x] The client relevance fallback now performs the configured bounded retry instead of stopping after its first transient timeout.
- [x] Product suggestions receive a bounded metadata-enrichment pass before Groq. An ASIN with neither a real title nor Amazon correlation themes cannot be rejected by AI without evidence; it remains available for explicit seller selection.
- [x] TypeScript, diff validation, 90 focused tests, and the full 981-test suite pass.
- [x] Clean Release archive `/tmp/InteliAds-352.xcarchive` was built without overwriting 351 and installed in place on the physical iPhone 14 Pro with its signed-in session preserved. The device reports `io.inteliads.app` version `1.0.1 (352)`; the archive executable SHA-256 is `d9c835bddfc260277f718e9c77a7b6fe46f1c68290f6581052b3afc6b91a7b00`.
- [x] Read-only physical-device smoke on build 352 covers the normal US and CA paths without an Amazon mutation. US Create Campaign Keywords completed at `Amazon 200 phrases / 600 rows / Kept 108` and opened with `Select all · 108`; US New Ad Group Products resolved the campaign ASIN and kept 40 of 470 expanded rows; US Add Keywords kept 93 and correctly exposed 92 after excluding the existing identity; US Add Products kept 36 with real title, cover, ASIN, match type, and Amazon theme metadata. The CA campaign resolved its own product and kept 10 of 140 rows. Every result opened with zero selected targets and no crash or RedBox.
- [ ] A physical tap/write pass still needs Apple UI automation to become available on this iOS 26 device before claiming that a tapped selection count exactly matches a new Amazon write. XCUITest installed but timed out while enabling automation mode; the same count/payload invariant is covered by the 981-test suite and the previous paused production write certification.
- [x] Implementation commit `0889ddeb` was pushed and merged through PR #60 at release-candidate commit `39335003`. The tested archive was exported with Apple Distribution, production APNs and `get-task-allow=false`; IPA SHA-256 is `c4d7f5ee58970ea1a803d4ad6577afcf22807529cca074caf5212cbeb45aaf1e`. App Store Connect processed build 352 successfully; its status is **Testing** in the internal **Intelyads** group as of October 3, 2026.

## Build 353 — external TestFlight distribution

- [x] Starts from the exact merged build 352 release candidate; no application code or certified behavior changed. Only the five authoritative build-number references advanced from 352 to 353, and the active Cursor checkout remained untouched.
- [x] TypeScript, build-number launch safety, diff validation, and the full 981-test suite pass.
- [x] Clean Release archive `/tmp/InteliAds-353.xcarchive` is `io.inteliads.app` version `1.0.1 (353)` with executable SHA-256 `a61d36d94e456ce867c394a02c1ee6d085de80ebf703a4dd147df359c68aa932`. The public TestFlight export is signed for App Store distribution with production APNs and `get-task-allow=false`; IPA SHA-256 is `8d915bfdaa6c912e3ff2b359c619ad025ba99c7229dee63e3c4e01b282a1971b`.
- [x] Build-number commit `af33efba` was pushed and merged through PR #63 at release-candidate commit `5505908e`.
- [x] App Store Connect accepted and processed the public upload. Build 353 was added to the external **Intelyads** group with tester notes covering campaign/ad-group targeting, AI suggestion filtering, selection counts, dashboard freshness, background refresh, and order notifications; its status is **Testing** as of October 3, 2026.

## Build 354 — full-portfolio notifications and shared fresh cache

- [x] Starts from release-candidate commit `db6eb30fb60c73ed42a15e8b54a996e615a710f4`, which contains merged implementation PR #65 and build-number PR #66. The active Cursor checkout remained untouched.
- [x] Background financial refresh and order notifications calculate from the complete activated Ads/KDP portfolio. The Ads Engine marketplace/profile picker no longer narrows Home financial totals or notification totals.
- [x] The root app uses the shared `appQueryClient`, so background prefetch, Create Campaign, KDP Manager, and foreground screens read the same cache instead of issuing avoidable cold duplicate reads.
- [x] TypeScript, release stress validation, lint with zero errors, focused notification/cache coverage, and the full 981-test suite pass.
- [x] Clean Release archive `/tmp/InteliAds-354.xcarchive` is `io.inteliads.app` version `1.0.1 (354)` with executable SHA-256 `3a59cfb3818e61d4b6f3ebe6f376130abcea68e42fc9136eb28ce95d15f0bcc3`. The App Store export is signed by `Apple Distribution: Emilian Susanu (AQ5FWX4K8Y)`, has production APNs and `get-task-allow=false`, and its IPA SHA-256 is `83eae0b8c1e7c9977a1bed5bf2d94d941852c4ad005a749be7af163adbc74a13`.
- [x] Build 354 was installed in place on the physical iPhone 14 Pro with the signed-in session preserved. A read-only navigation stress covered Home, Campaigns, Targeting, Products/Books, More, Settings, Accounts, KDP Helper, Sync, and Home again with zero JavaScript errors, hard errors, crashes, or RedBox.
- [x] The physical-device Overview displayed current all-portfolio totals for October 1–3: Gross `$361`, Net `$174.59`, Ad Spend `$186`, ACoS `34.6%`, and Margin `48%`.
- [x] App Store Connect accepted and processed the public upload. Build 354 was added to the external **Intelyads** group (3 testers) with automatic notification and tester notes covering freshness, complete order totals, targeting suggestions, AI filtering, exact selection counts, metadata, timeouts, and KDP isolation. Its status is **Testing** as of October 3, 2026.

## Next release candidate — premium live mutations and dense campaign context

- [x] Starts from the exact merged build 354 release candidate in the isolated `codex/ios-premium-live-mutations` worktree; the active Cursor checkout remains untouched.
- [x] Overview sync chrome shows a circular loading state, a short green completion state, then returns to rest. Failed or stale syncs never show the green confirmation.
- [x] Keyword, product-target, and ad-group bid/state writes patch flat, `{ rows }`, and infinite `{ pages }` caches immediately, then reconcile active queries with Amazon in the background. A permanent failure restores the confirmed value.
- [x] Targeting exposes one-tap `Select all` for every loaded Keywords, ASIN, Auto, Category, and Placement result while retaining honest loaded/global counts.
- [x] Campaign detail labels the selected performance period and previews keyword/product-target counts and names inside each ad group. Spend, impressions, clicks, orders, and ACoS remain date-range scoped.
- [x] Overview operational cards remove redundant borders and padding while preserving all verified values; dense widget rows add orders and clicks without inventing missing metrics.
- [x] Full 984-test iOS unit suite, TypeScript, lint with zero errors, and stress validation pass.
- [ ] Implementation is committed, pushed, reviewed, and merged into `feat/ios-release-candidate`.
- [ ] A clean next-numbered archive is installed and smoke-tested on the physical iPhone 14 Pro before any TestFlight upload.

## Release invariants

- No fake zero, placeholder metric, stale total, or silent unfiltered fallback.
- Global filters, date range, sorting, entity counts, and mutations retain their real scope.
- Gross = verified KDP royalties; Net = Gross minus date/market-aligned Ads spend.
- Paused entities can be seen and resumed; archived entities stay excluded.
- Never overwrite a known-good archive and never splice JavaScript into an older archive.
- Before cleanup: verify commit, push, merge, clean status, and preservation of all other worktrees.
