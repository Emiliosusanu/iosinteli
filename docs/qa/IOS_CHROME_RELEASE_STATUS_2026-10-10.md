# Release evidence, 10 October 2026

Mass distribution is not yet certified. This note supersedes older release-status conclusions, without relabeling prior evidence.

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
