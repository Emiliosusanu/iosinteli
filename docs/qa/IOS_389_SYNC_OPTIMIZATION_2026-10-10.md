# iOS 389 sync optimization candidate — 2026-10-10

Canonical checkout: /Users/emiliansusanu/Downloads/iosapp-inteli-wt-release-20261007
Branch: codex/ios-merge-20261007. Parent before this change: 7331a168.
Version configuration: app, widget, Info.plist and Xcode project are aligned to 1.0.1 (389).

This is a source/bundle candidate. It has not been installed on the physical phone or uploaded to TestFlight.
The user's TestFlight 388 background trial remains on its existing binary; this report must not be interpreted as field certification of 389.

## Changes

The same bounded rolling marketplace scheduler as Chrome candidate 1.2.160 replaces fixed batches of three.
Concurrency stays at three stores / nine report requests. On failure, no new stores are started; all active report siblings drain before the incomplete day is deferred.
Successful native coverage still requires all 17 stores plus atomic database write acknowledgement and cloud readback.
Existing royalty regression/quarantine and legitimate refund/zero handling remain unchanged.

Structured per-marketplace timing entries retain currency, duration, outcome and skipped state.
The offline diagnostic queue retains the original account binding even if the helper account later changes.
The server-side diagnostic redaction change is in robo_ads PR #732; it is not yet deployed.

The evening physical-388 readback exposed a completion-state error after pricing transport failures.
The 389 candidate keeps pricing exceptions, pending work and report soft failures in Retrying (or Action required for the authentication gate), without advancing the full-completion stamp.
Successful report captures remain preserved. See IOS_388_DAYTIME_BACKGROUND_READBACK_2026-10-10.md for actual device and cloud evidence.

## Validation

- 1,087/1,087 unit tests passed after the completion-state correction.
- TypeScript passed.
- Canonical release guard passed for build 389.
- Metro/Hermes iOS export succeeded again at /tmp/inteliads389-ios-export-return after the completion-state correction.
- Shared scheduler bytes match the Chrome source.
- Behavioral tests verify that a partial native day writes nothing and that a verified zero day is supported.
- Offline timing upload test verifies original account binding and structured support detail.

Chrome live canary evidence is available in robo_ads PR #732. VPS1 candidate completed two days with fresh 17-store cloud coverage.
Its slow second sweep isolated GB/GBP at 24.468 seconds while all other stores completed in about a second or less; upstream delays remain.
These source optimizations do not guarantee an exact 15-minute iOS wake or replace the outstanding real blocked-Amazon-gate field test.

No new remote admin KDP command/backfill API is implemented here. Existing diagnostic ingestion remains the admin support channel.
