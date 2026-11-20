# iOS release source reconciliation, 19 Nov 2026

Branch `codex/ios-release-source-recovery-20261119`. Merges `main` (a7d4bbc5, includes PR #136) into the canonical local release line (`aa262043`, branch `codex/ios-477-canonical-source-20261119`, 352 commits since merge base `822f063b`). Merge base to main is 60 commits.

## Result in one paragraph

All 70 conflicted paths were resolved by a per-hunk decision, not a global side. In every conflicted hunk the local line was the later evolution of the same code, or deliberately differed from main in a way that protects data or access. The merged tree equals the canonical source plus one added test (`frontend/tests/kdp-correction-stage.test.js`, +8 lines). Everything main added that is not a conflict was already present in the local line, byte for byte where it matters: the gateway and session files from PR #136, the three 2026-11-03 security migrations, `schedule_kdp_wake_cron_v2.sql` and the `kdp-wake-push` function.

## Preserved from main (verified identical to main a7d4bbc5)

| Area | Files |
| --- | --- |
| Gateway destination and session keep-alive (PR #136) | `src/lib/supabase.ts`, `src/lib/supabaseDestination.ts`, `tests/supabase-gateway-migration.test.js`, `src/lib/supabaseSession.ts`, `src/lib/sessionRefresh.ts`, `src/lib/authRestore.ts` |
| Security migrations (#131 to #135) | `supabase/migrations/20261103124654_*`, `20261103125447_*`, `20261103130527_*`, `supabase/schedule_kdp_wake_cron_v2.sql`, `supabase/functions/kdp-wake-push/index.ts` |
| Native project (no native source differs from main) | `frontend/ios/**` except whitespace in `project.pbxproj` |

`AuthContext.tsx` and `AppContext.tsx` took the local side: it keeps the same "only an explicit invalid-session signal signs the user out" rule as PR #136 and adds `isPermanentSessionError`, `supabaseSessionIsUsable` and a bounded background `getUser`.

## Conflict decisions that change behaviour relative to main (please review)

1. **Billing** (`app/more/billing.tsx`): purchase is blocked until the current plan is confirmed and StoreKit product evidence exists; an account-owner check runs after awaits; the paywall never shows Nest web price or trial text. Main falls back to Nest price/description/"N-day trial".
2. **Targeting book filter** (`app/(tabs)/targeting.tsx`): when the book-options read fails with a filter active, the page query is not fired (main fired it unscoped, widening to all campaigns). A retry state is shown instead.
3. **Book detail in USD** (`booksProfileScope.ts`): selection is never widened to all enabled marketplaces because of display currency (main widened).
4. **Timeouts are terminal** (`booksReadRecovery.ts`, `queryTimeout.ts`, `campaign/create.tsx`): 408, 57014, `HOME_QUERY_TIMEOUT` and statement timeouts are not retried (main retried them, and Create had one soft retry).
5. **KDP write path** (`kdp/upsert.ts`, `kdp/importer.ts`): the phone no longer seals `kdp_marketplace_day_coverage` from a client readback; it requires the server receipt (`completeCaptureVerified`, `captureVerificationVersion` 1) and sends `captureEvidence`. Requires the server contract below.
6. **Overview widgets** (`overviewWidgetEligibility.ts`, `queries.ts`): search terms require a live campaign and ad group; active-parent filtering happens server side through RPC `get_ad_groups_with_metrics(p_user_id, ...)` before top-N ranking.
7. **Notifications**: server test push (`requestServerTestPush`) stays removed, test notification is local only; `stress-test-release.sh` keeps the audit that forbids it.
8. **Same-market book retail merge** (`bookRetailMetadata.ts`): observations merge per field instead of latest `checkedAt` winning, so real stock and reviews are not erased by a thinner later read.

## Main tests with no same-named equivalent in the merged tree (22)

Replaced by a renamed or stronger local test unless noted. None was weakened to pass.

- Phone-side coverage sealing and old importer harness (11, KDP): `actual writer seals full native coverage only after matching cloud readback`, `actual writer leaves failed, incomplete or superseded coverage pending`, `staged refund candidates never seal marketplace coverage`, `confirmed zero activity still seals all 17 native storefronts without inventing facts`, `a success acknowledgement for another account cannot seal this account`, `transaction-verified receipt avoids full mobile readback while an invalid receipt stays pending`, `actual importer writes one USD All day and 17 native market facts`, `actual importer never replaces a day when any native store fails`, `signed native units reach the actual atomic writer without clamping`, `complete native zero corrections are decided by the server rather than a legacy client heuristic`, `a partial marketplace selection cannot bypass the legacy overwrite protection`. Local equivalents: receipt rejection, reconciled signed USD and native reports, raw response gaps, explicit 17-store zero correction, partial or duplicate scope cannot replace a day.
- Retry and scope (2): `a timed-out read recovers with two bounded retries`, `USD book detail covers enabled marketplaces while preserving non-USD selection` (decisions 3 and 4).
- Eligibility (2): `historical search terms remain eligible even under inactive campaigns or groups` (decision 6); `actual widget query resolves active parents before top-N...` replaced by `widget reads use server period ranking and enabled parent predicates without a client catalog scan`.
- UI structure (7): header market flag discs, five-capsule targeting pills, compact sticky, Gross status breathing lane, Books list hierarchy, targeting Paused comment, `automatic duplicates are blocked and create defaults paused` (renamed `...create starts paused`, same assertions).

## Verification run in this checkout

- `npx tsc --noEmit`: exit 0.
- `npm run test:unit`: 1574 tests, 1574 pass, 0 fail (canonical source re-verified the same day: 1573 pass, tsc exit 0).
- No conflict markers anywhere in tracked files.
- `npm run test:stress`: PASSED, 111 of 111 audits and 1574 of 1574 tests. One audit (`kdp interval tick AppContext`) was stale on the canonical source too: it looked for the literal `runKdpIosHelperTick("interval"`, while the local line wires the timer as `setInterval(() => tick("interval"), 15 * 60_000)` and forwards `reason`. It now checks that wiring and the forwarding, so it still fails if the timer is removed.
- Not run: `npm run test:cert` (needs the iPhone and tests the installed build, not this source), `npm run ios:release-guard` (needs the `.ios-canonical-worktree` marker of the blessed worktree), Xcode build, TestFlight tests.

## What a new binary candidate requires

1. **A new build number.** `main` and the canonical source both say build 477 with different JavaScript. The app has no `expo-updates`, so any JS difference ships only in a new binary. The 477 on main is the gateway-only candidate. Pick a number higher than the highest build already uploaded to App Store Connect (not verifiable offline) and change all of: `frontend/app.json` `ios.buildNumber`, `ios/InteliAds/Info.plist`, `ios/InteliAdsSyncWidget/Info.plist`, and the four `CURRENT_PROJECT_VERSION` entries in `project.pbxproj`. `scripts/assert-ios-release-line.sh` fails if they differ.
2. Run the release guard from the blessed canonical worktree (baseline `e14241ad` is an ancestor of this branch), then `test:stress` and `test:cert`.
3. Server contracts must be live in production before the build reaches users (read only check: the code exists in robo_ads origin/main): `kdp-sync` complete-capture receipt (`completeCaptureVerified`, `captureVerificationVersion`), RPC `get_ad_groups_with_metrics` with `p_user_id`, the 2026-11-03 security migrations. Deployment status was not checked and no database was touched.
4. Device checks that unit tests cannot give: upgrade from an installed earlier build keeps the session (storage key `sb-sjdlkprlkaweyuiaigix-auth-token` behind `https://api.inteliads.io/db`); APNs environment resolution on a development-signed and a distribution-signed build; KDP background wake with the 15 minute budget; StoreKit sandbox purchase and restore with the new plan-confirmation gate.
5. Do not reuse any previously uploaded 477 artifact for this source.

## Chrome extension 1.2.250 (checked against sources, read only)

Two different zips carry the version string 1.2.250.

| Artifact | SHA-256 | Source | In main |
| --- | --- | --- | --- |
| `InteliAds-Sync-1.2.250-Chrome-Web-Store-PR1222.zip` and `InteliAds_Releases/Chrome/InteliAds-Sync-1.2.250.zip` | `f8426534b4fc94816476b2ab94f6157afb2b19156d3853792d8a3e9b3c56c38b` | robo_ads `cab0a269`, shipped files identical | yes (live/main) |
| `InteliAds-Sync-1.2.250-Chrome-Web-Store.zip` | `80f683abd757abadec291d31d988192008c1179d54af6b43289c53500f8a825e` | robo_ads `dde7d6a9` (`codex/kdp-pricing-sweep-expiry`), shipped files identical | no |

The second differs in `sw.js`, `kdp-pricing-capture.js`, `kdp-pricing-work.js` (price sweep expiry and current paperback ASIN pairing). Only one can be 1.2.250 in the Web Store: upload the PR1222 zip, and give the sweep-expiry work its own version (1.2.251) after it merges.

Permissions of 1.2.250 are identical to 1.2.248: `storage, tabs, scripting, alarms, sidePanel`; hosts for the Supabase project, `api.inteliads.io` (covers the gateway `/db`) and the Amazon storefronts; optional `kdp.amazon.com`, `kdpreports.amazon.com`; external messages only from `https://dashboard.inteliads.io/*`. The code uses no API outside these (`chrome.management.getSelf` needs no permission). `advertising.amazon.com` appears in code but is dead and not requested. No `eval`, `new Function`, `importScripts` or remote code. `live/main` extension equals the PR1222 zip. 812 of 812 extension tests pass on `cab0a269`.
