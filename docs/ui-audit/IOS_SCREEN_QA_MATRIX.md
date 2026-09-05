# InteliAds iOS Screen QA Matrix

Pass = code matches the design system and the screen was refined this pass.  
Partial = system tokens apply; on-device dark / Dynamic Type / large-value walk still needed.  
n/a = state does not apply.

Code/layout columns remain from earlier workstreams. Dark / Accessibility / Final QA below are updated only where a real iPhone Simulator screenshot was taken on 2026-08-22. See `IOS_DEVICE_QA.md`.

| Screen | Spacing | Typography | Hierarchy | Components | Dark | Accessibility | Loading | Empty | Error | Final QA |
| ------ | ------- | ---------- | --------- | ---------- | ---- | ------------- | ------- | ----- | ----- | -------- |
| Overview | PASS | PASS | PASS | PASS | PASS (iPhone 17) | PARTIAL (combined metric labels in code; VO not spoken) | PASS | PASS (no account / no KDP / no books) | PASS (seller Retry on finance error; admin bootstrap Retry) | PASS |
| Campaigns | Pass | Pass | Pass | Pass | PASS (iPhone 17) | PASS (VO engine + captions; row labels on live tree) | Pass | Pass | Pass | PASS |
| Targets | Pass | Pass | Pass | Pass | PASS (iPhone 17) | PASS (combined row spoken; switch/bid independent) | Pass | Pass | Pass | PASS |
| Books | PASS | PASS | PASS | PASS | PASS (iPhone 17) | PASS (combined row label + hint on live tree) | PASS | PASS (account / search / range) | PASS (retry only when empty) | PASS |
| More | PASS | PASS | PASS | PASS | PASS (iPhone 17) | PASS (combined row labels on live tree; VO not spoken) | n/a (no destination queries) | n/a | n/a | PASS |
| Campaign detail | PASS (code/layout) | PASS (code/layout) | PASS (code/layout) | PASS (code/layout) | PASS (iPhone 17) | PASS (identity + budget/switch labels on live tree) | PASS (code/layout) | PASS (code/layout) | PASS (code/layout) | PASS |
| Keyword detail | Pass | Pass | Pass | Pass | PASS (iPhone 17) | PASS (identity + bid/switch on live tree) | Pass | Pass | Pass | PASS |
| Target detail | Pass | Pass | Pass | Pass | PASS (auto Substitutes dark) | PASS (identity + bid/switch on live tree) | Pass | Pass | Pass | PASS |
| Search-term detail | Pass | Pass | Pass | Pass | PASS (iPhone 17) | PASS (identity + Add/Negate labels; fixture) | Pass | Pass | PASS (device section error) | PASS |
| Book detail | PASS | PASS | PASS | PASS | PASS (iPhone 17) | PASS (identity + campaign row labels on live tree) | PASS (identity first; campaigns load below) | PASS (period / no account / no ASIN) | PASS (campaign retry keeps identity) | PASS |
| Ad group detail | PASS (code/layout) | PASS (code/layout) | PASS (code/layout) | PASS (code/layout) | PASS (iPhone 17) | PASS (identity + child rows + pause on live tree) | PASS (code/layout) | PASS (code/layout) | PASS (code/layout) | PASS |
| Bid bot | PASS | PASS | PASS | PASS | PASS (iPhone 17) | PASS (status/Run/Apply/Revert labels on live tree; VO not spoken) | PASS (status/recs/run/apply/mode save separate) | PASS (not run yet vs none now vs placements vs activity) | PASS (status/recs/apply/run/mode/revert distinct) | PASS |
| Ad groups | PASS (code/layout) | PASS (code/layout) | PASS (code/layout) | PASS (code/layout) | PASS (iPhone 17 fixture) | PASS (row + independent switch on live tree; fixture) | PASS (code/layout) | PASS (device empty Active; fixture populated) | PASS (code/layout) | PASS |
| Negatives | PASS | PASS | PASS | PASS | PASS (iPhone 17 fixture) | PASS (combined read-only row labels; search labeled; VO not spoken) | PASS (initial spinner; cached rows stay on refresh) | PASS (profile / view-as / search / type / true empty) | PASS (RetryState empty-cache; inline refresh error) | PASS |
| Search terms | PASS | PASS | PASS | PASS | PASS (iPhone 17) | PASS (sort/search labels on live tree; row labels in code) | PASS (spinner only when empty) | PASS (account / search / filter / period) | PASS (retry when empty; cache stays) | PASS |
| Rules | PASS | PASS | PASS | PASS | PASS (iPhone 17) | PASS (create/row/switch labels in code; empty catalog) | PASS (spinner only when empty) | PASS (account / none yet) | PASS (retry when empty; cache stays) | PASS |
| New rule | PASS | PASS | PASS | PASS | PASS (iPhone 17) | PASS (name/scope/threshold/action/CTA labels + units in code) | PASS (edit hydrates; missing rule is empty, not create) | n/a | PASS (couldn't open / save keep values) | PASS |
| Rule activity | PASS | PASS | PASS | PASS | PASS (iPhone 17 fixture) | PASS (combined execution row; VO not spoken) | PASS (spinner only when empty) | PASS (guest / profile / view-as / none yet) | PASS (RetryState empty-cache; inline refresh error) | PASS |
| Rule detail | PASS | PASS | PASS | PASS | PASS (iPhone 17) | PASS (status/time/row labels in code) | PASS (entities load under summary) | PASS (no-change vs no records vs failed) | PASS (entity RetryState keeps summary) | PASS |
| Sync | PASS | PASS | PASS | PASS | PASS (iPhone 17) | PASS (status/action/refresh labels on live tree; VO not spoken) | PASS (checking ≠ syncing; actions stay visible) | PASS (no selected vs no logs vs no sessions) | PASS (status Retry ≠ job failure) | PASS |
| Data coverage | PASS | PASS | PASS | PASS | PASS (iPhone 17 fixture) | PASS (grouped source/status labels; VO not spoken) | PASS (initial spinner; source-specific partial states) | PASS (profile / view-as / Ads / KDP / period) | PASS (whole-screen Retry + per-source failures) | PASS |
| Amazon accounts | PASS | PASS | PASS | PASS | PASS (iPhone 17 view-as) | PASS (row/switch labels on live tree; VO not spoken) | PASS (error keeps list if cached; empty Retry) | PASS (no profiles vs KDP missing vs view-as) | PASS (profile Retry / KDP Retry) | PASS |
| Settings | PASS | PASS | PASS | PASS | PASS (iPhone 17) | PASS (labels on live tree; VO not spoken) | n/a (no settings query) | n/a | n/a (local prefs; no false saved banner) | PASS |
| My account | PASS | PASS | PASS | PASS | PASS (iPhone 17) | PASS (combined labels on live tree; VO not spoken) | PASS (profile scope Checking/Unavailable; button pending) | PASS (plan/status/profile honest; guest) | PASS (billing fallback; local sign-out fallback) | PASS |
| Welcome | PASS | PASS | PASS | PASS | PARTIAL (light device; Reduce Motion in code) | PASS (Sign in / Next labels; VO not spoken) | n/a | n/a | n/a | PASS |
| Login | PASS | PASS | PASS | PASS | PASS (iPhone 17 Auth QA) | PASS (labels on live tree; VO not spoken) | PASS (Signing in…) | n/a | PASS (form-level + humanized) | PASS |
| Signup | PASS | PASS | PASS | PASS | PASS (iPhone 17 Auth QA) | PASS (labels on live tree; VO not spoken) | PASS (Creating…) | n/a | PASS (humanized) | PASS |
| Forgot / reset | PASS | PASS | PASS | PASS | PASS (forgot light; reset web-copy light) | PASS (labels in code; VO not spoken) | PASS (Sending… / Saving…) | n/a | PASS (generic + web-finish) | PASS |
| Boot / splash | PASS | n/a | n/a | PASS | PARTIAL (splash canvas stays white) | PASS (Checking session) | PASS | n/a | n/a | PASS (auth gate) |
| Profile sheet | Pass | Pass | Pass | Pass | Partial | Partial | Pass | Pass | n/a | Partial |
| Date sheet | Pass | Pass | Pass | Pass | Partial | Partial | n/a | n/a | n/a | Partial |
| Bid / budget editor | Pass | Pass | Pass | Pass | Partial | Partial | Pass | n/a | Pass | Partial |

## Remaining device checks

Done on iPhone 17 (402pt) this checkpoint: light + dark + Dynamic Type (XXXL / AXL) for Campaigns, Targets, Campaign Detail, Ad Group Detail; Keyword Detail light+dark; ASIN + Auto target light. MetricStrip clip of `91.8%` / `160.6%` was a real render defect and is fixed. Evidence: `IOS_DEVICE_QA.md`.

Still open after device/a11y closure (not this gate):

1. Pull-to-refresh (not reopened).  
2. Remote APNs sender (deployment) — not a Settings redesign.  
3. Dedicated Profile / Date / Bid-editor shots remain Partial.  
4. Overview leftovers (disabled queries) stay unrendered.

`CORE DEVICE QA: PASS` — see `IOS_DEVICE_QA.md`.  
`BOOKS LIST: PASS` — see Books evidence in `IOS_DEVICE_QA.md`.  
`BOOK DETAIL: PASS` — see Book Detail evidence in `IOS_DEVICE_QA.md`.  
`SEARCH TERMS LIST: PASS` — see Search Terms list evidence in `IOS_DEVICE_QA.md`. Populated rows are a DATA gap (no Nest `filterUserId`), not a UI blocker.

`RULES LIST: PASS` — see Rules list evidence in `IOS_DEVICE_QA.md`. Populated rows are a DATA gap (`fetchOptimizationRules` uses logged-in `user_id`, no Nest `filterUserId`), not a UI blocker.

`RULE BUILDER: PASS` — see Rule Builder evidence in `IOS_DEVICE_QA.md`. Create stays disabled. Edit hydrates from `{ id, rule }`. No production Rule was created or enabled.

`RULE EXECUTION DETAIL: PASS` — see Execution Detail evidence in `IOS_DEVICE_QA.md`. `[id]` is an execution ID. Populated entity rows are `DEVICE POPULATED STATE: BLOCKED BY SAFE DATA AVAILABILITY`. No Rule was run to generate history.

`DASHBOARD DATA & ARCHITECTURE: PASS` — `IOS_DASHBOARD_DATA_AUDIT.md` (unchanged this UI pass).

`DASHBOARD / OVERVIEW UI: PASS` — see Overview evidence in `IOS_DEVICE_QA.md`. Shots: `dashboard-standard-light.png`, `dashboard-standard-dark.png`, `dashboard-standard-largetype.png`, `dashboard-standard-xltype.png`, `dashboard-small-light.png`, `dashboard-large-light.png`. Pre-refinement baselines kept as `overview-current-*.png`.

`REMAINING IOS COVERAGE: MAPPED` — 2026-08-22 inventory in `IOS_REMAINING_COVERAGE.md`. Remaining Final QA **Partial** rows (Profile/Date sheets, Bid editor) were **not** promoted. Auth / Welcome / My Account / Negatives / Data coverage / Rule activity are no longer Partial.

`ACCOUNTS SAFETY: PASS` — `IOS_ACCOUNTS_SAFETY_AUDIT.md`.

`ACCOUNTS UI: PASS` — see Accounts evidence in `IOS_DEVICE_QA.md`. Safety semantics unchanged.

`SYNC DATA & STATE: PASS` — `IOS_SYNC_DATA_AUDIT.md`. Semantics unchanged.

`SYNC UI: PASS` — see Sync evidence in `IOS_DEVICE_QA.md`. Ads-only status, Sync now ≠ completion, loading ≠ syncing, view-as locked. No live Sync Now / Cancel was run for screenshots.

`BIDBOT DATA + SAFETY: PASS` — `IOS_BIDBOT_DATA_SAFETY_AUDIT.md`. Semantics unchanged.

`BIDBOT UI: PASS` — see BidBot evidence in `IOS_DEVICE_QA.md`. Snapshot ≠ live; Apply/placement/Aggressive/Run-auto confirm; view-as locked; min/max display-only; no selected-profile scope claim. No live Apply / Run / Revert / Aggressive save.

`MORE ROOT: PASS` — More tab hub only.

`ACCOUNTS UI: PASS` — `/more/accounts` presentation only. Safety contract unchanged.

`SETTINGS UI: PASS` — see Settings evidence in `IOS_DEVICE_QA.md`. Unused min/max/cooldown/daily-budget editors removed. Notifications are local iPhone alerts, not remote push. Appearance is Follows system (not a button). KDP row is informational. No live test-alert tap that needed a denied-permission device.

`AUTHENTICATION UI: PASS` — see Auth evidence in `IOS_DEVICE_QA.md`. Login/signup/forgot copy matches backend + web-finish reset. Guest is Preview demo. RouteGuard parks on loading and bounces authenticated users off `/auth/*`. Do **not** mark Onboarding PASS. Next coverage workstream is My Account. Do **not** start it from this file.

`MY ACCOUNT UI: PASS` — see My Account evidence in `IOS_DEVICE_QA.md`. Missing plan/status are Unavailable, not Pro/Active. Metadata plan stays labeled metadata-only. View-as cannot replace signed-in identity. Billing opens the verified web host. Sign-out clears guest/view-as/query scope and returns to auth; production sign-out confirmation was canceled on device. Next coverage workstream is Negatives. Do **not** start it from this file.

`NEGATIVES UI: PASS` — see Negatives evidence in `IOS_DEVICE_QA.md`. Negative keywords and product targets use human type/state labels, campaign/ad-group scope, local search, explicit 500-row cap, and read-only rows. Admin view-as is blocked rather than showing a false empty because no customer-scoped Nest read exists. Next coverage workstream is Data Map. Do **not** start it from this file.

`DATA MAP UI: PASS` — see Data coverage evidence in `IOS_DEVICE_QA.md`. `/more/data-map` is now a mixed coverage diagnostic, not a profit dashboard. Missing KDP stays unavailable, Ads/KDP orders remain source-specific, partial failures remain visible, and unsafe customer view-as is blocked.

`RULE ACTIVITY UI: PASS` — see Rule activity evidence in `IOS_DEVICE_QA.md`. `/more/rule-history` is recent execution history, not the Rules catalog. Rows are executions; `[id]` on detail is an execution ID. Status labels stay shared with Execution Detail. View-as is blocked. Revert/Reapply stay on detail.

`DEVICE + ACCESSIBILITY CLOSURE: PASS` — Targets combined row spoken; Ad Groups dark + XXXL fixture; mutation-sensitive detail VoiceOver labels on the live tree; 16e Targets populated.

`NOTIFICATION INFRASTRUCTURE: PASS` — local alerts mapped; prefs enforce generation; taps use allowlisted event routes (not Overview-only / not `data.url`); token identity cleared on sign-out. Remote sender is **TOKEN REGISTRATION ONLY** / `BLOCKED BY DEPLOYMENT`. See `IOS_NOTIFICATION_INFRASTRUCTURE_AUDIT.md`.

`FINAL RELEASE-WIDE REGRESSION: PASS` — `IOS_FINAL_RELEASE_REGRESSION.md`. UI/UX phase frozen. Representative smoke: `regression-*.png`. Do **not** start a new UI stream from this file.

Closed this pass: Campaigns sort chip (Spend + clear, 44pt); 16e / Pro Max populated core screens; Search Term Detail (fixture + Dark); keyboard type/clear + budget pad; Reduce Motion; list scroll-restore.

Books List (2026-08-22): identity + royalties/spend hierarchy; search vs range empty; Spend sort; Dark; XXXL 2×2; row opens Book Campaigns. 16e / Pro Max Books chrome rendered; those devices had no admin catalog session (empty range), so populated rows were verified on iPhone 17 (402pt).

## Acceptance (code)

- Hierarchy: profit and entity names outrank chips and icons.  
- Density: list filters share one chrome; covers are 52×70.  
- Spacing: 16 page pad, 8 list gap, 10 card radius.  
- Typography: 600 + regular; tabular metrics.  
- Native: grouped More/Settings, SF Symbols, no card shadows.  
- Touch: 44pt fields; compact chips use hitSlop.  
- Context: Overview period stepper; other screens share `dateRange`.  
- Data: `0` vs `—`; `RetryState` vs empty.  
- Safety: guest alerts and bid editors unchanged.  
- AI-slop: leftover Overview widgets not shown; unused Dynamic Island not mounted.
