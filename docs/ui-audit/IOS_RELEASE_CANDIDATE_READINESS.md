# InteliAds iOS — Release Candidate Readiness

Date: 2026-08-23

`INTELIADS IOS RELEASE CANDIDATE: READY`

Hard gate used: `FINAL RELEASE-WIDE REGRESSION: PASS` in `IOS_FINAL_RELEASE_REGRESSION.md` (the recorded phrase; the follow-up alias `INTELIADS IOS RELEASE REGRESSION: PASS` was not a separate file).

Readiness gate for this document remains `READY`. Execution is recorded in `IOS_TESTFLIGHT_BUILD_REPORT.md`: branch + commits created; TestFlight **1.0.0 (3)** uploaded and still processing. Main was not merged or pushed.

---

## Current git state

| Field | Value |
| --- | --- |
| CURRENT_BRANCH | `main` (tracks `origin/main`) |
| HEAD | `eb009bdbb309166c4073b2907f14a039432a231e` — `Push project to GitHub` |
| WORKTREE_STATUS | Dirty. ~1,173 in-scope paths plus thousands of `.metro-cache` deletions |

### TRACKED_MODIFIED (product-relevant; metro-cache omitted)

`frontend/app.json`, `frontend/package.json`, `frontend/yarn.lock`, `frontend/metro.config.js`, tracked `frontend/app/**` and `frontend/src/**` listed in the Final Regression inventory, icon/splash assets, `frontend/.env`.

### UNTRACKED (groups)

- New screens + libs (`frontend/app/auth/{forgot,reset,welcome}`, details, BidBot, Sync, Data Map, Rules, tests, contracts)
- Untracked `frontend/ios/` prebuild product sources (25) + `ios/build 2/` (88)
- `frontend/android/**` generated tree
- `docs/ui-audit/**`, `docs/ios-product-map/**`, screenshots
- `.agents/skills`, `claude-code-apple-skills-main`, `Swift-Agent-Skills-main`, `.claude/skills`
- Landing page, `skills-lock.json`, `supabase/**`

### IGNORED_RELEVANT_FILES

`frontend/ios/Pods/`, `frontend/ios/build/` (Pods **not** present on disk). Root `.gitignore` matches `.env` but `frontend/.env` is **already tracked**.

---

## Release scope

Ship in a source commit (JS/TS product + Expo config + assets + optional native iOS project files):

| File / group | Category | Ship in source commit? | Runtime bundled? | Action |
| --- | --- | ---: | ---: | --- |
| `frontend/app/**` | PRODUCT | Yes | Yes | Commit on release branch |
| `frontend/src/**` | PRODUCT | Yes | Yes | Commit |
| `frontend/app.json` `package.json` `yarn.lock` `metro.config.js` | PRODUCT | Yes | Config / deps | Commit |
| `frontend/assets/images/icon.png` (+ adaptive, splash used by config) | PRODUCT | Yes | Yes | Commit |
| `frontend/scripts/patch-expo-constants-path.js` | PRODUCT | Yes | postinstall only | Commit |
| `frontend/ios/` product sources (not `build 2`) | PRODUCT native | Yes if using Xcode archive | Native binary | Commit after review |
| `frontend/tests/**` | TESTS | Yes (repo) | No | Separate commit |
| `docs/ui-audit/**` `docs/ios-product-map/**` | QA DOCS | Optional | No | Separate commit |
| `docs/ui-audit/device-screenshots/**` | SCREENSHOTS | Optional | No | Separate commit or omit |
| QA inject scripts | QA SCRIPTS | n/a | n/a | None in repo |
| `.agents/skills` Apple skill trees | SKILLS | No | No | Leave dirty |
| `frontend/.env` `.metro-cache` `ios/build 2` | ENV / CACHE | **No** | Env at build via secrets | Do not commit |
| `frontend/android/**` | UNRELATED to iOS RC | No (this RC) | Android only | Leave |
| `frontend/package-lock.json` | UNRELATED (yarn repo) | No | No | Leave |
| Landing page / `supabase/**` | UNRELATED | No | No | Leave |

---

## QA-only files

Tests, QA docs, screenshots, skill repos, historic `/tmp` injectors (not imported). None are production-reachable fake-data modes.

---

## Secret audit

`SECRET DIFF: CLEAN` for the **intended** release commit (`.env` excluded).

Working-tree `frontend/.env` is tracked and dirty: packager hostname is **LOCALHOST** in the diff; Nest URL key is HTTPS. Do **not** commit `.env`. Provide `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_RULES_API_URL` via EAS secrets / CI. No service-role, Amazon, APNs, or password keys appeared in the inspected key list.

---

## App config

| Field | Value |
| --- | --- |
| APP NAME | InteliAds |
| BUNDLE IDENTIFIER | `io.inteliads.app` |
| SCHEME | `inteliads` (native also `io.inteliads.app`) |
| VERSION | `1.0.0` (`app.json`, `Info.plist`, `package.json`) |
| IOS BUILD NUMBER | `1` |
| EXPO SDK | 54 (`expo` ~54.0.35; `expo config` reports `54.0.0`) |
| RUNTIME VERSION | none |
| EAS PROJECT ID | **not configured** (no `eas.json`, no `extra.eas.projectId`) |

Xcode `MARKETING_VERSION` is `1.0` (warn only). `DEVELOPMENT_TEAM` is present in the untracked pbxproj.

**Version strategy: KEEP** `1.0.0` / build `1`. Repository does not know App Store Connect consumption.

---

## Bundle / deep links

Consistent: `io.inteliads.app` in `app.json`, pbxproj, Android package (unused this RC). Schemes `inteliads` + `io.inteliads.app`. Notification routes are in-app paths, not a QA scheme. Reset email goes to `https://dashboard.inteliads.io/reset-password`.

---

## Permissions

| PERMISSION | WHY USED | CONFIGURED | RELEASE BLOCKER? |
| --- | --- | --- | --- |
| Notifications (system) | Local alerts + optional token | Runtime `expo-notifications`; no custom usage string | No |
| Background fetch / processing / remote-notification | Alert task + APNs capability | `app.json` + Info.plist | No |
| Camera / photos / location / mic / tracking | — | Not used | No |

---

## Notifications / background

- LOCAL NOTIFICATIONS = IMPLEMENTED
- REMOTE PUSH SENDER = NOT IMPLEMENTED
- Settings copy: “This is not remote push”
- Plugin: `expo-notifications`, `expo-background-task`
- `aps-environment` = **development** → TestFlight/production **remote** APNs needs Apple provisioning. Not a UI lie; local alerts do not require production push.
- JS task `io.inteliads.app.background-refresh`; plist permits Expo id `com.expo.modules.backgroundtask.processing` (Expo mapping). Timing not guaranteed.

---

## Auth / Amazon / API

| Check | Result |
| --- | --- |
| Supabase URL/anon from env | Yes; warn if missing |
| Reset URL | `https://dashboard.inteliads.io/reset-password` |
| Guest / RouteGuard | Unchanged |
| Amazon connect/login URL | Nest `GET` then `WebBrowser`; no localhost in source |
| Nest base | `EXPO_PUBLIC_RULES_API_URL` (working-tree value class HTTPS) |
| Source localhost | None in `frontend/app` / `frontend/src` / `app.json` |
| ATS | `NSAllowsArbitraryLoads` false; `NSAllowsLocalNetworking` true (local LAN only) |

---

## Build validation

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| Focused tests | 131 PASS / 2 FAIL (stale data-mapping 6 + 13 only) |
| `npx expo config --type public` | Resolves identity above |
| `npx expo-doctor` | 5 checks failed (Android icon 512×513; nav duplicates; CNG sync warning; expo 54.0.35 vs 54.0.37) — not treated as iOS product P0 |
| Local Release compile | **BLOCKED** — `frontend/ios/Pods` missing; no `eas.json`. Do not `expo prebuild` in this pass. |

**Recommended process (next workstream, not this one):**

1. Branch + commit the isolated product set.
2. Either EAS iOS (`eas build --platform ios --profile production` after adding `eas.json` + secrets), **or** `pod install` in `frontend/ios` then Xcode Archive.
3. Do not submit from this pass.

---

## Tests / stale cases

| Case | Class |
| --- | --- |
| data-mapping test 6 | STALE TEST (signature grew `filterUserId`; scope still present) |
| data-mapping test 13 | STALE TEST (`btOrganicOrders` removed; documented in dashboard audit) |

No new real failure.

---

## Fixture / debug

| Hit | Class |
| --- | --- |
| Guest Preview demo | PRODUCTION-REACHABLE by design; empty / mutation-blocked |
| `debugDataScope` | DEV-ONLY unless `EXPO_PUBLIC_DEBUG_DATA_SCOPE=true` |
| `devWarn` in notifications | DEV-ONLY (`__DEV__`) |
| D15 debugger toast | DEV-ONLY (Metro / Expo Go-style); absent in store/TestFlight without packager |
| inject- / fixture / qa- in app+src | None |

`FIXTURE/DEBUG LEAKAGE: PASS`

---

## TestFlight prerequisites

| Requirement | Status |
| --- | --- |
| Bundle ID `io.inteliads.app` | READY (source) |
| Version / build | READY to keep 1.0.0 / 1 |
| Icons / splash assets | READY |
| Privacy strings for used APIs | READY (none extra required) |
| Export compliance `ITSAppUsesNonExemptEncryption` false | READY (source) |
| Apple signing / profiles / ASC app record | UNKNOWN / NEEDS EXTERNAL CHECK |
| EAS credentials | UNKNOWN (no EAS project) |
| Production APNs entitlement | TESTFLIGHT/DEPLOYMENT if remote push wanted; not required for local-alert RC |

---

## App Store review concerns (not redesigns)

- Billing CTA opens `https://dashboard.inteliads.io/billing` (web-managed; no IAP). May draw digital-goods / reader-app questions.
- Preview demo is a real entry point (honest empty state).
- Sign in with Apple: **N/A** (email + Amazon browser only; no Google/Facebook).
- Do not implement IAP or Sign in with Apple in this freeze.

---

## Accepted gaps

Remote sender; onboarding wizard; mixed FX; customer-scoped Nest reads; iOS billing source; mobile Ads disconnect; D3 `(tabs)` back; D15 dev toast; data-mapping stale tests.

P2/P3 remain in `IOS_DEVICE_POLISH_BACKLOG.md`. Frozen.

---

## Release blockers

| ID | Area | Blocker | Owner | Required before RC |
| --- | --- | --- | --- | --- |
| — | — | **NONE** in product source | — | — |

Deployment-only (not source RC blockers): Nest sender, production `aps-environment`, EAS/App Store Connect login, `pod install` or EAS for a binary.

---

## Commit plan (do not execute here)

Prefer branch `feat/ios-release-candidate` from `main` (do **not** dump the dirty tree onto `main`).

1. **iOS product** — `frontend/app`, `frontend/src`, `app.json`, `package.json`, `yarn.lock`, `metro.config.js`, used assets, `scripts/patch-expo-constants-path.js`, optionally `frontend/ios/` product sources (exclude `build 2`).
2. **tests** — `frontend/tests/*.test.js`
3. **QA docs** — `docs/ui-audit/*.md` (screenshots optional)

---

## Branch plan

Current: `main`. Recommended next: `feat/ios-release-candidate`. Not created this pass.

---

## Files that MUST NOT be committed

- `frontend/.env` and any `.env.*`
- `frontend/.metro-cache/**`
- `frontend/ios/build 2/**`
- `frontend/package-lock.json`
- `.agents/**`, `claude-code-apple-skills-main/**`, `Swift-Agent-Skills-main/**`
- `InteliAds_Landing_Page_Complete_Copy.md`
- `supabase/**` (unrelated dirty)
- `frontend/android/**` unless an Android RC is explicitly requested

---

## Final readiness

`INTELIADS IOS RELEASE CANDIDATE: READY`

Execution: `INTELIADS IOS TESTFLIGHT BUILD: UPLOADED`. `TESTFLIGHT PROCESSING: PENDING`. Device smoke is pending user/device install. Do not merge to main from this file.
