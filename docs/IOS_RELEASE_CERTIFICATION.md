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
- [x] Implementation commit `bed27fc0` was pushed, reviewed, and merged through PR #68 at release-candidate commit `5dcb726a`.
- [x] The healthy idle header no longer restores the previous permanent green dot after the transient completion state. The focused regression test and TypeScript pass; PR #71 was merged before the final archive.
- [x] Targeting paints the authoritative globally ranked page before optional ASIN display enrichment. Visible-row titles and covers fill in after first paint without changing global sort, filters, metrics, or entity identity; display-only timeout handoff is silent while real failures remain observable. The full 984-test suite, TypeScript, lint with zero errors, and stress validation pass; PR #73 was merged before the final archive.
- [x] Clean Release archive `/tmp/InteliAds-357.xcarchive` is `io.inteliads.app` version `1.0.1 (357)` from release-candidate commit `7998101a4d95dbdc7c93cdd6afea8e7b5fe8bc23`; executable SHA-256 is `dbafb0eca157afe0262fa51c7ba5b2e0a42c61bdae6d7f45daa58292c935e019` and code signing verifies successfully.
- [x] Build 357 was installed in place on the physical iPhone 14 Pro with the signed-in session and cached account data preserved. Home shows current Gross `$361`, Net `$173.95`, Ad Spend `$187`, ACoS `34.8%`, and Margin `48%` for October 1–3, with no idle sync indicator.
- [x] The physical Targeting stress covered Keywords, ASIN, Auto, Category, Placement, bid ceiling, ACoS range, and impression filters with no crash, RedBox, or `HOME_QUERY_TIMEOUT`. The ASIN page displayed the real globally ranked metric rows at first paint and filled real titles in the visible viewport in the background.
- [x] Build-number PR #74 was merged at `7998101a`. Build 357 remains a device-certified release candidate and has not been uploaded to TestFlight.

## Next release candidate — confirmed disabled-market campaign creation

- [x] Starts from release-candidate certification commit `8156abdf` in the isolated `codex/ios-create-other-marketplaces` worktree; the active Cursor checkout remains untouched.
- [x] Create Campaign requests the exact-ASIN marketplace probe with disabled connected Ads profiles included.
- [x] A disabled marketplace is offered only when Amazon Ads returns live `in_stock` evidence for that exact owned `profile_id`. Country, currency, shared marketplace ids, stale book links, and catalog-only or historical-product-ad evidence cannot create a choice.
- [x] The seller sees one marketplace chooser for the selected book. Disabled rows are labelled `Enable & use` and require a second explicit confirmation before the profile is enabled or selected.
- [x] Campaign preview and creation remain gated by the server's enabled-profile check. The app updates its local profile scope only after the Nest enable mutation succeeds, then starts Ads sync and reconciles the profile cache.
- [x] iOS TypeScript, lint with zero errors, the focused cross-account/stock suite, and the full 987-test suite pass.
- [x] Server PRs #608 and #609 are merged and deployed from production commit `307dd6701e1041e676f8a0c51a1725b500fa83c9`. Discovery can resolve credentials for a connected disabled profile only for the read-only exact-ASIN check; preview, create, and every mutation retain the enabled-profile gate. The focused 42-test regression suite, full client/server workflow, image builds, and production deploy are green.
- [x] Clean Release archive `/tmp/InteliAds-358.xcarchive` is `io.inteliads.app` version `1.0.1 (358)` from release-candidate commit `1002cdeca24ddfda264714d09ce73ed354707f70`; executable SHA-256 is `118895ef254bbde27f5e685383144d438d1dedd85fb31ff4762b75d2b319b294`. It was installed in place on the physical iPhone 14 Pro with the signed-in session preserved. Its separately exported App Store IPA has SHA-256 `24de8d1f5134e6247843c3eaa26d4cd5ee6cb9690fcf6facecc3cdc96a7fa721`, production APNs, `get-task-allow=false`, and was accepted by App Store Connect for processing.
- [x] Physical-device verification used owned paperback `B0G1MW7MQD`. Production checked 55 connected profiles in about 4 seconds and returned exact-profile `in_stock` evidence for disabled marketplaces. Build 358 opened the marketplace chooser automatically, showed the active US profile as `Choose`, and labelled disabled confirmed rows such as AU, CA, DE, FR, and IT as `Enable & use`. The final enable action was deliberately not confirmed, so the read-only certification changed no Ads profile.
- [x] Post-upload cold relaunch on the physical iPhone 14 Pro preserved the signed-in session and painted the same-scope cached Home result in 184 ms; authentication restored in 416 ms and the current server result replaced it without a timeout. The October 1–3 view showed Gross `$377`, Net `$175.20`, Ad Spend `$202`, ACoS `34.3%`, and Margin `47%` with no placeholder dash or informational banner.
- [x] A filtered live device log captured 25,842 records across launch, authentication, Home refresh, KDP scope resolution, and background activity. It contained no React exception, RedBox, `HOME_QUERY_TIMEOUT`, fatal app error, or new InteliAds crash report. Four initial HTTP 401 responses recovered automatically and were followed by successful 200/201 requests; the only native fault/error records were UIKit/CoreUI framework diagnostics. The build process remained alive after the audit.
- [x] The exact post-upload source still passes the full 987-test unit suite and TypeScript. The isolated iOS and server worktrees are clean and match their remote release/main heads; the active Cursor checkout was not modified.
- [x] App Store Connect processed build 358 and added it to the external **Intelyads** group (3 testers), with automatic tester notification and focused notes for campaign creation, disabled-market eligibility, exact keyword/product selection counts, AI metadata, financial freshness, KDP isolation, immediate mutations, and notification totals. Its status is **Testing** as of October 3, 2026.


## Build 359 — rejected archive: WidgetKit extension missing

- [x] Starts from external-testing release commit `479639e5` in the isolated `codex/ios-home-widget-integrity` worktree; the active Cursor checkout remains untouched.
- [x] Home distinguishes verified zero from missing/error data. A successful empty Today read renders `$0`; query failures cannot impersonate zero or overwrite the last verified financial snapshot.
- [x] Marketplace Ads retains every enabled marketplace after a verified read, including countries whose spend, orders, and clicks are all zero. Budget Today, Automation, and Review Queue keep their card state without hiding verified-empty results or presenting failed reads as successful zeros.
- [x] The native widget source shows verified rolling-seven-day Gross, Ad Spend, and Net. It accepts real zeroes, clears incompatible/unlinked scopes, clears on sign-out, and expires financial values after six hours instead of showing stale money.
- [x] The unsigned Release build, TypeScript, diff validation, focused widget tests, and the full 991-test suite passed.
- [x] The signed `/tmp/InteliAds-359.xcarchive` exposed a release-blocking project defect: it contained no `PlugIns/InteliAdsSyncWidget.appex`. Build 359 was rejected before upload and must not be distributed.

## Build 360 — embedded WidgetKit finance

- [x] Starts from merged build 359 source in the same isolated worktree; the active Cursor checkout remains untouched and the rejected 359 archive remains preserved.
- [x] Restores the missing `InteliAdsSyncWidget` native target, source phases, app dependency, and `Embed App Extensions` copy phase.
- [x] Adds a regression test that fails if the target or embedded `.appex` wiring disappears.
- [x] Clean Release archive `/tmp/InteliAds-360.xcarchive` contains the signed `PlugIns/InteliAdsSyncWidget.appex`; both app and widget pass strict signature validation and carry `group.io.inteliads.app`. The archive installed on the physical iPhone 14 Pro as `1.0.1 (360)` without removing the signed-in session. The October 1–3 Home view rendered verified Gross `$384`, Net `$173.36`, Ad Spend `$210`, ACoS `33.1%`, and Margin `45%` without a banner or placeholder dash. Development executable SHA-256 values are `ba7b5728a7785b197e98c3c571fd2475aea1d1c277f456f44876424f623e7b8c` for the app and `89f395a95984bbcd5856b9c99def62e6f19e3da8d3fd4e4f37a58dfb67108e50` for the widget.
- [x] App Store export `/tmp/InteliAds-360-export/InteliAds.ipa` has production APNs, `get-task-allow=false`, and the shared App Group in both signed bundles. IPA SHA-256 is `77513907367b456aa67465f11d3c68eae97fd315cc06c443f2d3e746e8840e15`; distribution executable SHA-256 values are `6eac927320c38cf8da52d7e5e6d78c56c0c4a3569bffa6b1db7f4ac561fdffb3` for the app and `9207237b8e65b1b51725f987f5ec7388ae82d2acb2727c5253621d2778165b27` for the widget. App Store Connect accepted and processed build 360, added it to the external **Intelyads** group, and reports status `Testing` for its three external testers as of October 3, 2026.

## Build 362 — exact-period campaign and ad-group targeting parity

- [x] Starts from release-candidate commit `802d7f055285837b3ca2dda1a505cfd940b919e5` in the isolated `codex/ios-book-sort-sync-360` worktree. The Downloads source checkout and every unrelated worktree remain untouched.
- [x] Campaign and Ad Group details use the same `mobile_targeting_page_v1` / `exact-period-cascade-v1` contract as Targeting. The server globally filters and ranks the complete campaign scope for the selected date window before the client limits rendering to 200 rows.
- [x] Ad Group detail filters that complete immutable campaign snapshot by the exact Amazon `ad_group_id`; it does not issue a separate lifetime-metric read or silently retain lifetime values after a timeout.
- [x] Campaign keyword order remains the authoritative global ACoS order. Product-target segments use the same period metrics and deterministic ACoS/spend/impression comparator before the visible cap.
- [x] Visible product targets fill missing competitor titles in bounded 40-row background waves. Metadata cannot change entity identity, metrics, totals, selection, mutation payloads, or rank.
- [x] Production read-only verification for Greece campaign `392589382427313` returned 1,051 keywords across three RPC pages and 579 ASIN targets across two pages. The full keyword catalog completed in 1.605 seconds; the full ASIN catalog completed in 2.531 seconds. Campaign totals for October 1–4 matched production: `$31.42` spend, `2` orders, `36` clicks, and `98.4%` ACoS.
- [x] The physical iPhone 17 Pro Max preserved the signed-in session after in-place build 362 installation. Build 362 Campaign detail showed the exact production campaign totals. The Greece-filtered Targeting device read showed `greek gifts` at `39.4%` ACoS followed by `athens` at `9.0%`; the shared RPC response and source-contract tests verify that Campaign and Ad Group consume that same ranked snapshot before their display cap.
- [x] Full iOS unit suite passes: 996 tests, 0 failures. Focused lint reports 0 errors. The clean archive `/tmp/InteliAds-362.xcarchive` is `io.inteliads.app` version `1.0.1 (362)` with app executable SHA-256 `5002eeac6edbd131184a244a6453f66900b8e5b1cc689c267971059a21124e55` and JavaScript bundle SHA-256 `7cfa494e414958b2f40e4764fdfc91c69ca7b9c61b9cd0c016494175af80cd61`.
- [ ] Build 362 is a device certification build. Do not upload it to TestFlight or replace the external group build until this branch is reviewed and merged into the release candidate.

## Release invariants

- No fake zero, placeholder metric, stale total, or silent unfiltered fallback.
- Global filters, date range, sorting, entity counts, and mutations retain their real scope.
- Gross = verified KDP royalties; Net = Gross minus date/market-aligned Ads spend.
- Paused entities can be seen and resumed; archived entities stay excluded.
- Never overwrite a known-good archive and never splice JavaScript into an older archive.
- Before cleanup: verify commit, push, merge, clean status, and preservation of all other worktrees.

## Build 364 — KDP freshness honesty and TestFlight production entitlements

- [x] Starts from the isolated `codex/ios-364-kdp-freshness` worktree at commit `8376ac51`; the Downloads source checkout and unrelated worktrees were not edited.
- [x] When only the KDP importer is outside the freshness window, Overview reports `KDP data stalled` / `KDP stale` instead of the ambiguous generic `Stale` badge. Ads freshness remains independently represented.
- [x] Regression coverage verifies the KDP-only stale state and the existing Ads failure state; TypeScript and the focused launch/motion suite pass (15/15).
- [x] Clean archive `/tmp/InteliAds-364.xcarchive` is `io.inteliads.app` version `1.0.1 (364)`. Its archive executable SHA-256 is `9bfd2d947f5ef7be3ff9b19cd5eea417d28b5dc5f72f320c7496ef1fd05b8640`; the JavaScript bundle SHA-256 is `7ecea98c4e3889eebc6c1e8be7c773cee83a2c661cd71d2ac2497f849f7bb2c4`.
- [x] The App Store Connect export was separately verified as production-signed: `aps-environment=production`, `get-task-allow=false`, App Group present, build `364`, and IPA SHA-256 `0d85062a4deddff9cc67c6fcb388186871988a96ef521d8ed4f1775729cf90a2`.
- [x] App Store Connect accepted the public upload and returned `Uploaded InteliAds` / `EXPORT SUCCEEDED`; Apple processing and external-group assignment remain a portal-side state to verify after processing completes.
- [x] The owner confirmed that build 364 is now pushed to the external TestFlight group; the connected iPhone 14 Pro still reports build 363, so production notification certification remains pending the TestFlight installation of 364.
- [x] Production APNs transport was verified after installing 364 through TestFlight: the active device token is registered as `production` for `io.inteliads.app`, the app process was terminated, and the `send-push` function received HTTP `200` from Apple for that token. Two older sandbox tokens correctly returned `403 BadEnvironmentKeyInToken` and were not treated as current-device failures.
- [x] The owner confirmed the visible `Server push is live` alert on the TestFlight-installed 364 device with the app terminated, completing the end-to-end notification check.

## Greece targeting audit after build 364

- [x] The October 1–4 production snapshot for campaign `392589382427313` and ad group `293314040581514` contains 1,051 keyword entities: 804 enabled and 247 paused. All three iOS surfaces reference the same stored Amazon keyword IDs and exact-period RPC; Campaign and Ad Group include paused rows to allow resuming them, while the supplied Amazon Ads screenshot filters to Enabled. The screenshot does not display keyword IDs, so it cannot independently prove row identity against Amazon.
- [x] For the visible rows, keyword text, match type, bid, clicks, spend, orders, and ACoS match the supplied Amazon Ads screenshot. Its table sorts by clicks; iOS sorts by ACoS and spend. Those differences in order are expected until the sort controls match.
- [ ] Impression totals do not fully match the October 4 Amazon screenshot: for example, `greek gifts` is 1,305 in Amazon and 1,320 in the app snapshot, while `greece travel guide` is 567 versus 580. The stored daily rows place the discrepancy in the still-changing October 4 bucket. This is a source freshness/reconciliation question, not evidence of a different keyword ID. Recheck the same profile, ad group, date window, state filter, and observation time against a fresh Amazon read before certifying metric parity.
- [x] The Campaign detail now labels its ranked 200-row preview honestly. Ad Group detail retains the full exact-period catalog, exposes an All states/Enabled filter, and lets the user reveal all 1,051 keywords in bounded 200-row steps; product targets use the same progressive treatment. Search runs against the complete catalog before rendering is bounded.
- [x] The UI correction is included in the clean build 365 archive and was installed in place on the physical iPhone 14 Pro without an install or launch error. Build 364 does not include it.
- [x] Physical iPhone 14 Pro build 365 walk-through on October 4 at 21:30–21:39 Bucharest time: Campaign `Greece - Keywords` labels its preview `Top 200 of 1051`; the Ad Group shows `Keywords (1051)` and the same first ranked rows and values at the same observation time. Targeting with the Greece book selected shows those same keyword rows in the same ACoS order. The Targeting selector uses parent ASIN `B0DPWWDBGL`; paperback `B0G1C3XP9J` is a sibling, not a separate campaign scope. The live RPC returns 804 enabled and 1,051 all-state keywords for the Greece campaign; adding the book's Greece Auto campaign ID does not change the keyword result.
- [ ] A fresh, simultaneous Amazon Ads impression comparison remains required before declaring metric parity. At 21:12 Amazon showed `greek gifts` 1,312 impressions, `greece travel book` 158, and `greece travel guide` 595. On the phone at 21:30–21:32, Campaign and Ad Group showed 1,312, 169, and 608 respectively; Targeting at 21:38 showed 1,314, 182, and 614. Bids, spend, clicks, orders, and ACoS for these rows matched. The impressions changed between observations even within the app's October 1–4 scope; the current evidence does not establish whether Amazon report revision, ingest, or another reconciliation mechanism caused the differences.

## Build 365 — full ad-group catalog for external QA

- [x] Starts from the unified release-candidate commit `0601a248` after PRs #94 and #95 merged. Only the five build references changed after that commit; the active Cursor checkout remained untouched.
- [x] TypeScript, the focused launch and targeting suite (14/14), the full iOS unit suite (997/997), and `git diff --check` pass.
- [x] Clean signed archive `/tmp/InteliAds-365.xcarchive` is `io.inteliads.app` version `1.0.1 (365)`, embeds `InteliAdsSyncWidget.appex`, and passes strict signature validation. Archive app executable SHA-256: `f16146c1292c43ea28b96bc02b0bf2562416a146324b36e0dcb88698d985f278`.
- [x] The separately exported App Store IPA `/tmp/InteliAds-365-signed/InteliAds.ipa` has build 365, production APNs, `get-task-allow=false`, and the shared App Group. IPA SHA-256: `211120c0e70029d175f48b8a9c55a7fe2aa1bf604d8f4d321f7ecd7e436e7c4e`.
- [x] The archive installed and launched on the connected physical iPhone 14 Pro; device inventory confirms `io.inteliads.app 1.0.1 (365)`.
- [x] Xcode reported `Uploaded InteliAds` / `EXPORT SUCCEEDED`. App Store Connect shows build `1.0.1 (365)` in the external **Intelyads** group (3 testers), status **Testing**, with focused QA notes and automatic tester notification selected.
- [ ] The impression discrepancy remains a release-parity issue. External TestFlight distribution of 365 is for tester verification of the UI and must not be described as a fully certified metric fix.

## Greece product-target audit after build 365

- [x] The October 4, 21:32 Amazon Ads screenshot is the enabled `Greece - Asin new` ad group (`510881724408429`) inside `Greece - Keywords` (`392589382427313`), profile `1120992069090651`, October 1–4. The exact-period RPC returns 446 enabled ASIN targets for this group. All 446 have a valid ten-character ASIN in their target expression. The screenshot's two `Unable to load` rows have no visible full ASIN/target ID, so their individual metadata cannot be matched from that image alone.
- [x] The four one-click targets match by full ASIN, bid, spend, clicks, and orders: `1835293611` ($0.80 / $0.80), `1838694595` ($0.80 / $0.75), `B0G4GV5WZR` ($0.86 / $0.86), and `1837583250` ($0.74 / $0.63). The connected iPhone 14 Pro build 365 ad-group header and the sum of its 446 enabled target rows both show 2,500 impressions, 4 clicks, $3.04 spend, and 0 orders. Individual impressions differ from the earlier Amazon screenshot for `1835293611` (21 versus 22) and `B0G4GV5WZR` (81 versus 79); simultaneous source parity is not yet established.
- [x] Scope distinction: campaign default All contains 579 product targets across both ad groups; the enabled `Greece - Asin new` ad group contains 446 enabled plus 19 paused targets. A separate paused ad group contains another 114. Targets filtered to the Greece book and Enabled returns exactly the same 446 IDs as the enabled Amazon group. The campaign preview caps display at 200; the ad-group detail can reveal its full catalog.
- [x] Found an actual rank mismatch for no-sale product targets: `mobile_targeting_page_v1` breaks ACoS ties by clicks, impressions, sync time, then ID, while Campaign and Ad Group had re-sorted those rows by spend. A focused red/green regression now makes both details use the RPC's order. TypeScript, focused tests (18/18), lint on changed source, and the full 999-test iOS unit suite pass. This code is after build 365 and is **not** yet on the physical phone or TestFlight.

## Build 366 — Greece product-target order for external QA

- [x] PRs #98 and #99 merged into the unified release candidate at `fc0506d951d9bf221103783b8cc3343310ce905d`. The build contains the Greece product-target order correction and the five build-number references; the primary checkout remains untouched.
- [x] The final source passes TypeScript and all 999 iOS unit tests. A clean Release archive `/tmp/InteliAds-366.xcarchive` succeeded with app and WidgetKit extension both at `1.0.1 (366)`; strict signatures verify. Archive app executable SHA-256: `16cb02cfe721d19115e984f68ae05e3510a70974a919693c0dbf56a9354510f3`.
- [x] The exported App Store IPA `/tmp/InteliAds-366-signed/InteliAds.ipa` has production APNs, `get-task-allow=false`, and the shared App Group. IPA SHA-256: `3809b5c373ce8eec6783a0f06a5dda6fedc1eb1fa4be0d056ef54c3c29257b4f`.
- [x] Xcode upload reported `Upload succeeded` and `Uploaded InteliAds`; App Store Connect shows build 366 at **Ready to Submit**, initially assigned only to the internal group.
- [x] App Store Connect shows `1.0.1 (366)` in the external **Intelyads** group (3 testers) with status **Testing** and 26 group builds. The group state changed while the TestFlight note was being prepared; the saved `What to Test` text and notification delivery were not verified.
- [ ] Confirm the changed sort on a physical iPhone after installing build 366; device build 365 cannot prove this correction.
- [ ] Reconcile impression changes with a fresh same-time Amazon Ads comparison. Matching ASIN IDs, spend, clicks, orders, and bids do not by themselves prove impression parity.

## Next build — Amazon listing reviews and stock on iOS

- [x] Books and book detail read the same `kdp_titles.amazon_rating`, `amazon_review_count`, `amazon_stock_status`, and `amazon_meta_updated_at` fields used by the web app. The read is limited to owned/linked KDP accounts and exact edition ASINs, and applies the existing book quarantine.
- [x] Missing reviews are shown as unavailable and missing stock as unknown; zero reviews is a real zero only when the source explicitly supplies zero. Any available rating or stock is labeled as a dated snapshot, never as live availability.
- [x] The metadata query does not delay financial books or replace their metrics on failure. Pull-to-refresh retries both reads. Admin view-as cannot accidentally read the signed-in user's private KDP listing data.
- [x] TypeScript and the full 1,002-test iOS unit suite pass in the isolated worktree.
- [x] An unsigned native Release build for iOS succeeds and embeds the existing WidgetKit extension; this is a compile check, not a signed TestFlight archive.
- [ ] The current connected database has no populated rating, review-count, or stock rows in `kdp_titles`; the web app's corresponding fields are also empty. The Ads `/product/metadata` cache has title/image/price but no review fields. Verify a real, authorized metadata source and populate exact-ASIN snapshots before claiming that values appear on device.
- [ ] Review, merge, build, and physical-device/TestFlight verification remain for this change. Build 366 does not contain it.
