# Release evidence, 10 October 2026

Mass distribution is not yet certified. This note supersedes older release-status conclusions, without relabeling prior evidence.

## Latest verified update (07:07 UTC)

- Apple processed build 386 and accepted the authorized external beta submission. App Store Connect visibly reports **Approved** and associates both internal and external Intelyads groups. Automatic tester notification was unchecked; Notify Testers was not clicked. This is approval evidence, not physical TestFlight installation or completed background import. Screenshot: [Apple 386 approval](IOS_386_APPLE_APPROVED_2026-10-10.png).
- Physical iPhone 17 Pro Max still reports installed InteliAds 1.0.1 (383). The request to update in place through TestFlight is pending; no developer installation, uninstall, or container reset was performed.
- Both VPS hosts again confirm manifest 1.2.159 and worker `1.2.159-pricing-probe-auth`, their original account IDs and signed-in sessions. Gate blocked=false, dirty pending=0, sync not running, latest result successful. Their 60-minute report and pricing alarms remain registered. VPS1's fresh six-book pricing pass remains the 84-row reconciliation evidence.
- Windows has candidate 159 staged but the latest runtime snapshot still shows worker 158. Its successful existing sync and intact Demo account do not certify runtime 159. Official extension Reload and readback remain pending.
- Latest production run 38032511105 is pending behind an earlier generation guard and the online, busy prod runner. PR validation run 38031675455 is currently executing client validation. Current containers still run `a2546777aeb5b1dcc7dc6b213df223d6a770845e`; deployed financial protection remains present, but latest main/package alignment is not yet certified.
- The product wake cron is active every 15 minutes. Dispatches at 06:15, 06:30, 06:45 and 07:00 UTC all returned HTTP 200 without a transport timeout. This certifies dispatch acceptance, not a guaranteed iOS wake or completed import.
- iOS targeting resolves row currency from the row's Amazon profile and passes selected profile IDs to each catalog request. Mixed-currency amount bulk changes are blocked with a Markets-filter prompt. This source review does not substitute for a live mutation test; no Amazon bids were changed.

Current release conclusion remains **not certified for unrestricted mass distribution**. Required human steps are the Windows official Reload and in-place TestFlight 386 installation; deployment convergence, native all-store foreground/locked background reconciliation, blocked-gate fallback/retry and real-admin genuine-refund acceptance remain explicit release gates.

## Latest verified update (06:55 UTC)

- iOS 386 includes the preserved account-switch cleanup changes, committed as `073bb19e`: a new helper destination is committed only after Keychain deletion/readback, native cookie cleanup, and every local journal removal succeed. Selecting the same account preserves its session and progress. All 1,074 tests and TypeScript pass. The signed 386 archive passes deep strict codesign validation; app/widget are both 386. External-eligible upload succeeded at 06:54:35 UTC. JS SHA256 `023f4e85596c547369deda96e743debbc3c871f76aec72de50dde8fb92988e7b`; native executable SHA256 `c34e553330a5fa6e0be7ea078efa04fc1d4caefd911b93a893fa194aaa6fa6c2`. Apple group availability and installation of 386 are not yet verified. The current Apple browser session is now authenticated, and 384/385 visibly show Testing; physical iPhone remains 383.
- Both VPS hosts now confirm runtime manifest 159 and worker `1.2.159-pricing-probe-auth` after controlled cold restarts with their original argv/profile/environment. Natural two-day startup syncs completed on VPS1 at 06:41 UTC and VPS2 at 06:48 UTC. Correct account identity, signed-in state and all clocks survived.
- VPS1's direct setup response is HTTP 200 JSON with 14 calculator markets. A separate authorized force pricing-only pass captured six account-owned live candidates in 21.8 seconds, with all five error counters zero, no deferred/dirty queue, and the real gate cleared. Database readback confirms 84 fresh rows with list price, printing cost, net royalty, currency and break-even present; no break-even math mismatch. No user login was needed to recover from the prior transport failure. The diagnostic capture itself did not write financial rows.
- Accepted account and book rows reconcile royalties/orders/KENP on October 9–10 for VPS1, VPS2 and Emilian. Both VPS account-days have current 17-store native coverage; Emilian's installed 383 still has no 17-store coverage marker. The genuine empty VPS2 day remains zero with no invented book rows.
- Windows 159 was staged at its original registered path after backup `C:\Users\Administrator\InteliAds-QA-Backup\159-staged-20261010-085007`. Official Chrome reload and final runtime readback remain pending. No Windows credentials/profile/account were replaced.
- PR #725 merged as `94edabca22f00eed23373ccb0e4c6f4c1c4eabe9`; PR #726 passed CI and merged as `edb9b2cba9b10d43d8c4bad6a3cba71e1cbcc231`. A later main merge superseded the deployment requests; latest production run `38032511105` / main `1a7729ec66ba99dddd140f5a44ae7c5404f3cb4e` is pending. Actual deployed image identity must still be verified before claiming production/source alignment.
- The retained HTTP-response window contains 24 successful scheduled dispatch responses, all HTTP 200 and zero dispatch errors. These prove APNs acceptance, not TestFlight 386 installation or every requested wake executing.

The sections below record earlier evidence in this session. The latest update above takes precedence for current versions and completed checks.

## iOS archive and background delivery

Build 385 preserves all 384 changes: USD All plus 17 native KDP Reports storefronts independent of Ads selection, verified database facts and revision-aware coverage, marketplace pricing, deferred backfill and correction safeguards. The native background completion gate now claims completion before publishing status; callbacks after expiration are ignored. A successful TaskManager wake does not overwrite a pending/login-required KDP snapshot with “Updated”.

The canonical source commit for native 385 is `7bafa826`. The signed archive `/tmp/inteliads385.xcarchive` passes deep strict signature verification, with app and widget both 385. Upload through the external-eligible export configuration succeeded at 2026-10-09 21:13:21 UTC. Native executable SHA256: `29c9fe3987d8c3e9b1e2ae50063488b9597589271f68eeeb6c95de43a67037f5`. JS SHA256: `adfe7af72c6d4dce0a34f9ad04abbb0d3b2bd5ce5017f9140b385a725f48df65` (unchanged from 384; the 385 fix is native). Upload is not external-group approval or installation evidence.

1,065 tests pass, including executable Swift completion/expiration races, complete native import/readback cases, and wake endpoint authentication. TypeScript, release guard and diff checks pass for the prepared 385 line. Later uncommitted 386 account-switch edits are preserved and are not included in the 385 archive or certified here.

The Supabase wake function is deployed with exact configured credential comparison. A forged JWT payload claiming `service_role` is rejected with HTTP 401. The distributed lease refuses overlapping dispatches and fails closed if unavailable. A dedicated cron secret leaves existing credentials unchanged. The active cron is `inteliads-kdp-wake-push`, `*/15 * * * *`. Financial account-day rows had the same aggregate fingerprint before and after scheduling.

At 2026-10-10 06:30 UTC, the latest three cron runs succeeded. Their HTTP responses were 200 with `sent=4`, `failed=0`, `pruned=0`. Disabled and stale tokens were skipped; no token values are exposed. APNs acceptance does not establish device delivery or a completed import.

The physical iPhone 17 still reports 383 at 06:33 UTC. Remote 383 logs show push wakes (including 06:00:56 UTC), completed report passes and ten priced books. This is useful proof that pushes can reach the helper, but does not certify the 385 TestFlight build, 17-store native coverage, or a locked-phone full import.

## Chrome and production

VPS1 and VPS2 preserve their original profile/account identities. Fresh 158-v2 automatic report syncs succeeded at 06:13 and 06:20 UTC. VPS2 has no pricing gate or dirty queue. VPS1 logged HTTP status 0 and no login redirect, which 158 wrongly classified as sign-in; a login requirement cannot be concluded from that evidence alone.

Candidate 159 fixes that classification without bypassing the real setup-page second gate. All 119 Chrome tests pass. ZIP SHA256: `4b57e6fcedc5fd1cc681ae847b027390836a8d8e040160bdb3186608cc77ddd4`. PR #726: https://github.com/This-Is-Working/robo_ads/pull/726 . On VPS1 an official warm reload retained cached manifest 158 while loading the new worker; a controlled cold restart used the exact original argv/profile/environment and then confirmed both runtime manifest 159 and worker `1.2.159-pricing-probe-auth`, same signed-in account. A natural 28-day resume is in progress; no full 159 sync/pricing success is claimed yet. VPS2 remains the 158-v2 comparison canary.

Production frontend/backend/AMS currently run `a2546777aeb5b1dcc7dc6b213df223d6a770845e`, including deployed financial protections. The later main deployment failed because PR #722 changed manifested bid scorer dependencies without refreshing their recorded identity. PR #725 repairs only metadata; identity verification, complete backend build, and 85 tests across six affected suites pass. https://github.com/This-Is-Working/robo_ads/pull/725 . CI/merge/deployment are still pending, so current main and deployed production must not be described as identical.

Windows last verified runtime is the first 158 worker, not final 158-v2/159. Its real price-change capture and automatic report sync passed previously, but the final release runtime still needs official reload and readback. No profile/account was transferred.

## Remaining release gates

- Green reviewed PRs and actual deployed image/package identity, not only source on disk.
- Completed candidate 159 VPS1 report/pricing pass, then same candidate on the other canaries.
- Final Windows runtime and natural sync with the original Demo account.
- TestFlight 385 (or a later explicitly validated build) installed in place; foreground and background imports reconcile all 17 native stores with current database coverage.
- Live native locked second-gate fallback and later successful retry; the simulated transports do not replace this evidence.
- Authorized real-admin acceptance of a genuine refund correction. The API exists; an admin review UI and this acceptance proof are not claimed.

BGAppRefresh, BGProcessing, silent pushes, foreground resume, single-flight import and deferred backfill are implemented. Their combined operation maximizes supported opportunities, but iOS controls delivery and can suspend or terminate work. Neither exact 15-minute execution nor an always-running replacement of Chrome is certified.
