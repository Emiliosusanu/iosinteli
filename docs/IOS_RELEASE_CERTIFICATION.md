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
- [ ] Clean build 340 archive contains the expected Overview stadium chrome.
- [ ] Device smoke on iPhone 14 Pro.
- [ ] TestFlight upload and Apple processing verified.

## Release invariants

- No fake zero, placeholder metric, stale total, or silent unfiltered fallback.
- Global filters, date range, sorting, entity counts, and mutations retain their real scope.
- Gross = verified KDP royalties; Net = Gross minus date/market-aligned Ads spend.
- Paused entities can be seen and resumed; archived entities stay excluded.
- Never overwrite a known-good archive and never splice JavaScript into an older archive.
- Before cleanup: verify commit, push, merge, clean status, and preservation of all other worktrees.
