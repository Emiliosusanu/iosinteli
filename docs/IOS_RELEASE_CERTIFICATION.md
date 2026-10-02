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

## Release invariants

- No fake zero, placeholder metric, stale total, or silent unfiltered fallback.
- Global filters, date range, sorting, entity counts, and mutations retain their real scope.
- Gross = verified KDP royalties; Net = Gross minus date/market-aligned Ads spend.
- Paused entities can be seen and resumed; archived entities stay excluded.
- Never overwrite a known-good archive and never splice JavaScript into an older archive.
- Before cleanup: verify commit, push, merge, clean status, and preservation of all other worktrees.
