# iOS build 373 — remote KDP diagnostics

Date: 2026-10-08

Artifact:

`/tmp/InteliAds-373-remote-diagnostics-20261008/Build/Products/Release-iphoneos/InteliAds.app`

Verified:

- canonical release worktree and build-number guard
- TypeScript
- 1,031 unit tests
- credential/JWT redaction
- exact account binding before offline queue persistence
- 200-entry offline queue and 25-entry authenticated batch drain
- cold-start and foreground retry wiring
- Release device build and codesign
- in-place install on iPhone 17 Pro Max as `1.0.1 (373)`

Main JS bundle SHA-256:

`ea0af36c0792fc570262ef81ffcb52c5315e17186d2495d1533f2e58932e79af`

The device was locked when the automated launch was first attempted. Installation succeeded;
live cloud-ingestion evidence must be recorded after an unlocked launch produces a helper
activity event.
