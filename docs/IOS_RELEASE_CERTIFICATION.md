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
- [x] Campaign AI filtering has production provider fallback across xAI, Groq, and OpenAI and fails closed when all providers fail.
- [ ] Server PR merged, migration deployed, and production endpoint verified without deleting a live book.
- [x] Full iOS unit suite (968 tests) and TypeScript pass.
- [ ] Physical iPhone 14 Pro smoke: campaign creation, ad group creation, add keywords, add products, AI filtering, keyword/product/auto controls, KDP Manager.
- [ ] Clean build 341 archived, installed without removing local data, and uploaded to TestFlight.

## Release invariants

- No fake zero, placeholder metric, stale total, or silent unfiltered fallback.
- Global filters, date range, sorting, entity counts, and mutations retain their real scope.
- Gross = verified KDP royalties; Net = Gross minus date/market-aligned Ads spend.
- Paused entities can be seen and resumed; archived entities stay excluded.
- Never overwrite a known-good archive and never splice JavaScript into an older archive.
- Before cleanup: verify commit, push, merge, clean status, and preservation of all other worktrees.
