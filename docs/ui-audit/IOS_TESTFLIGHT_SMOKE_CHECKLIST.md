# InteliAds iOS — TestFlight smoke checklist

Date: 2026-08-23

Release-build checks only. Do not rerun full UI QA. No live Amazon writes.

`REMOTE PUSH SENDER = NOT IMPLEMENTED`. Settings test is a **local** alert.

---

1. Install a **clean** TestFlight build (delete the Dev Client first if both exist).
2. Launch — splash, then session gate (“Checking session”), no Metro/LogBox/debugger toast.
3. Login **or** restored session. Guest/Preview demo still empty, not sample Ads data.
4. Amazon connect / LWA **browser return** to the app (Accounts or Login Amazon button). Do not complete a production disconnect.
5. Tabs: Overview, Campaigns, Targets, Books, More.
6. Open one Campaign.
7. Open one Target (keyword or product).
8. Open one Book.
9. More hub (Bid bot / Sync / Accounts / Settings reachable).
10. Settings: allow notifications if prompted; **Send a test on this iPhone**. Confirm it does **not** claim server push.
11. If a local test tap is available: Settings route. Do not expect a remote APNs message.
12. Background the app; resume. Session and selected profiles still correct.
13. Sign out — auth screen; previous user’s lists gone.
14. Sign back in (same device). No prior-user Ads/notification identity.

Fail the smoke if: crash on launch, QA fixture data, debugger toast, remote-push claim, localhost API, or leftover previous-user rows.
