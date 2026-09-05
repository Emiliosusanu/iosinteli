# InteliAds iOS — TestFlight Build Report

Date: 2026-08-23

`INTELIADS IOS TESTFLIGHT BUILD: UPLOADED`

`TESTFLIGHT PROCESSING: PENDING`

This workstream created `feat/ios-release-candidate`, committed the audited RC set, compiled Release, archived, exported an App Store IPA, and uploaded it to TestFlight. It did **not** merge to main, push the branch, submit App Store review, implement remote push, or run device smoke.

---

## RC branch

`feat/ios-release-candidate`

Created from local `main` at the validated readiness HEAD. No fetch, pull, or rebase.

## Base commit

`eb009bdbb309166c4073b2907f14a039432a231e` — `Push project to GitHub`

## Release commits

| Hash | Subject | Files | +/− |
| --- | --- | ---: | --- |
| `0cc04be5a8f2dd943b8a8e4ce80aa8274dd60daf` | `feat(ios): complete InteliAds mobile release candidate` | 115 | +33892 / −3678 |
| `118a2f8c185e253565fa1fc9dde9adff1cb0acfe` | `test(ios): add release safety and UI contract coverage` | 19 | +2172 |
| `c0687f3cfd43d3c88f1662efcd400dd78c4268b9` | `docs(ios): record release QA and readiness` | 18 | +5538 |
| (this file + readiness/progress/coverage updates) | `docs(ios): record TestFlight build execution` | — | — |

Forbidden-file check on `eb009bd..` product/test/docs commits: **PASS** (no `.env`, metro-cache, `ios/build 2`, Android, Supabase, skill trees, landing copy, `package-lock.json`).

## Excluded dirty files

Pre-write classification (current tree, before any git write):

| Category | Count |
| --- | ---: |
| PRODUCT CODE | 90 |
| TESTS | 19 |
| QA DOCS | 41 |
| SCREENSHOTS | 244 |
| QA SCRIPTS | 0 |
| IOS NATIVE PRODUCT | 25 |
| LOCAL/GENERATED | 5285 |
| UNRELATED | 667 |

**Screenshot decision:** omit `docs/ui-audit/device-screenshots/**` (244 PNGs). They inflate the repo and are not required once the audit markdown exists.

**Also left uncommitted:** `docs/ios-product-map/**` (planning docs; this commit used `docs/ui-audit/*.md` only), `.env`, `.metro-cache`, `frontend/ios/build 2`, `frontend/android`, `frontend/package-lock.json`, `.agents/skills`, `claude-code-apple-skills-main`, `Swift-Agent-Skills-main`, `supabase/**`, landing copy.

Do not delete or revert those paths.

## Secret check

`RELEASE SECRET CHECK: CLEAN`

Intended product/test/docs files had no passwords, tokens, service-role keys, Amazon credentials, or Apple private keys. `frontend/.env` was inspected for key class only and was not staged.

## Version / build

| Field | Source (repo / `app.json`) | Uploaded IPA |
| --- | --- | --- |
| Marketing version | `1.0.0` (kept) | `1.0.0` |
| Build | `1` (kept in source) | **`3`** |
| Bundle ID | `io.inteliads.app` | `io.inteliads.app` |

Xcode export used `manageAppVersionAndBuildNumber`. App Store Connect rejected creating upload `1.0.0` / `1` (already used). The uploaded binary is **1.0.0 (3)**. Source `buildNumber` / `CURRENT_PROJECT_VERSION` were not rewritten after upload.

## Build environment

- macOS + Xcode 26.5
- Existing native project `frontend/ios/InteliAds.xcworkspace`
- No `eas.json` created
- No `expo prebuild`
- Production `EXPO_PUBLIC_*` injected from local `frontend/.env` for compile only (HTTPS Supabase URL, present anon key, HTTPS Nest URL). Process environment did not have those keys. `EXPO_PUBLIC_DEBUG_DATA_SCOPE` unset.

`PRODUCTION ENV: READY` for this local Release compile.

## Native dependencies

CocoaPods already present; `Podfile.lock` matched `Pods/Manifest.lock`. `pod install` was not re-run. `Pods/` was not committed.

## Release compile

Command (Release, generic iOS device):

`xcodebuild -workspace frontend/ios/InteliAds.xcworkspace -scheme InteliAds -configuration Release -destination generic/platform=iOS -derivedDataPath /tmp/InteliAds-RC-DerivedData DEVELOPMENT_TEAM=AQ5FWX4K8Y build`

Result: `** BUILD SUCCEEDED **`

Archive:

`xcodebuild … -archivePath /tmp/InteliAds-RC.xcarchive archive`

Result: `** ARCHIVE SUCCEEDED **`

Local `.app` / `.xcarchive` were development-profile signed. App Store re-sign happened at export.

## Signing

Export used Cloud Managed Apple Distribution + `iOS Team Store Provisioning Profile: io.inteliads.app`.

- Team: `AQ5FWX4K8Y`
- `aps-environment`: **production** (IPA)
- `get-task-allow`: false
- `beta-reports-active`: true

`SIGNING: READY` for the uploaded IPA.

Local keychain still lacks a standing Apple Distribution identity for CLI `find-identity`; Xcode used a cloud-managed distribution certificate during export.

## App Store Connect

App record exists: Apple app id `6776622511`, bundle `io.inteliads.app`.

Build `1` for `1.0.0` is already consumed. Uploaded build is `3`.

`altool --list-apps` without API key/app password failed. Upload used the existing Xcode App Store Connect session.

## Upload

Command:

`xcodebuild -exportArchive -archivePath /tmp/InteliAds-RC.xcarchive -exportPath /tmp/InteliAds-RC-upload -exportOptionsPlist /tmp/InteliAds-UploadOptions.plist`

Options: method `app-store-connect`, destination `upload`, `testFlightInternalTestingOnly=true`.

Result: `Upload succeeded` / `Uploaded package is processing.`

IPA (pre-upload export copy): `/tmp/InteliAds-RC-export/InteliAds.ipa`  
Archive: `/tmp/InteliAds-RC.xcarchive`

No App Store review submission. No public release. No external tester invite from this workstream.

## Processing

Last confirmed App Store Connect upload state: **PROCESSING**.

`TESTFLIGHT PROCESSING: PENDING`

Not waited indefinitely. Not claimed ready to install.

## TestFlight smoke

`TESTFLIGHT DEVICE SMOKE: PENDING USER/DEVICE INSTALL`

This environment cannot install a TestFlight build. Use `IOS_TESTFLIGHT_SMOKE_CHECKLIST.md` after the build becomes installable.

## Remaining gaps

- Remote push sender still **NOT IMPLEMENTED**
- Onboarding still PARTIAL (Welcome + empty states)
- Web billing handoff remains an App Store review concern (not redesigned)
- Source build number still `1`; uploaded build is `3`
- data-mapping tests 6 and 13 still stale (class A)
- P2/P3 frozen
- App Privacy questionnaire not filled (inventory only)
- Branch not pushed; not merged to main

## Next action

1. Wait until App Store Connect finishes processing 1.0.0 (3).
2. Install via TestFlight and run `IOS_TESTFLIGHT_SMOKE_CHECKLIST.md`.
3. Do not submit App Store review until privacy answers, billing review risk, and smoke are decided.
4. Push `feat/ios-release-candidate` only if an explicit review/share is requested.
)
