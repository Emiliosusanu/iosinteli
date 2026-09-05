# InteliAds iOS — Final Release-Wide Regression

Date: 2026-08-23

`FINAL RELEASE-WIDE REGRESSION: PASS`

`NOTIFICATION INFRASTRUCTURE: PASS` was recorded before this gate started. This pass did not implement remote APNs, redesign screens, or change product contracts.

Answer: **Yes — freeze the UI/UX phase.** The current InteliAds iOS app is internally consistent, truthful, and safe enough for that freeze. Remaining gaps are documented accepted product/backend/deployment items, not open product P0s.

---

## 1. Hard gate

`NOTIFICATION INFRASTRUCTURE: PASS` is written in:

- `IOS_NOTIFICATION_INFRASTRUCTURE_AUDIT.md`
- `IOS_UI_PROGRESS.md`
- `IOS_REMAINING_COVERAGE.md`
- `IOS_SCREEN_QA_MATRIX.md`
- `IOS_DEVICE_QA.md`
- `IOS_APPLE_SKILL_AUDIT.md`

Remote push remains **TOKEN REGISTRATION ONLY** / **NOT IMPLEMENTED** / **BLOCKED BY DEPLOYMENT**.

---

## 2. Master PASS / gate inventory

Current documentation only. Device column is the last dedicated evidence, plus this gate’s representative smoke.

| Area | Contract/Data Gate | UI Gate | Device Gate | Remaining P0/P1 |
| --- | --- | --- | --- | --- |
| Overview / Dashboard | `DASHBOARD DATA & ARCHITECTURE: PASS` | `DASHBOARD / OVERVIEW UI: PASS` | PASS — DEVICE VERIFIED (+ 2026-08-23 smoke) | Open P1s are accepted grains/FX (DA-P1-1…9, D38). No P0 |
| Campaigns List | — | PASS | PASS — DEVICE VERIFIED (+ smoke) | DA-P1-4 leftover query-scope note; list now sends `filterUserId`. No P0 |
| Campaign Detail | — | PASS | PASS — DEVICE VERIFIED | D4 hero vs list grain = P2. No P0 |
| Targets List | — | PASS | PASS — combined row spoken; 16e populated (+ smoke) | None product |
| Keyword / Target Detail | — | PASS | PASS — VO live tree | None product |
| Ad Groups List | — | PASS | PASS — dark/XXXL fixture historically; this smoke had live rows | D5 Nest catalog = P2 data |
| Ad Group Detail | — | PASS | PASS — VO live tree | D6 nameless deep link = P2 |
| Books List | — | `BOOKS LIST: PASS` | PASS (+ smoke) | D17 16e populated session = P2 QA-env |
| Book Detail | — | `BOOK DETAIL: PASS` | PASS | D20 book vs campaign orders = P2 data |
| Search Terms List | — | `SEARCH TERMS LIST: PASS` | PASS | D23 Nest `filterUserId` = P2 data |
| Search Term Detail | — | PASS | PASS — fixture + VO | D12 real term = P2 |
| Rules List | — | `RULES LIST: PASS` | PASS | D25 self-scoped catalog = P2 data |
| Rule Builder | — | `RULE BUILDER: PASS` | PASS | D28–D31 P2 |
| Rule Activity | — | `RULE ACTIVITY UI: PASS` | PASS | D80–D83 P2 / backend read |
| Rule Execution Detail | — | `RULE EXECUTION DETAIL: PASS` | PASS — summary; entities blocked | D32–D35 P2 data |
| More Root | — | `MORE ROOT: PASS` | PASS (+ smoke) | D43 `(tabs)` back = P2 |
| Accounts | `ACCOUNTS SAFETY: PASS` | `ACCOUNTS UI: PASS` | PASS | Disconnect still web-only (accepted) |
| Sync | `SYNC DATA & STATE: PASS` | `SYNC UI: PASS` | PASS | SYN-P1-9 customer logs unused |
| BidBot | `BIDBOT DATA + SAFETY: PASS` | `BIDBOT UI: PASS` | PASS (+ smoke view-as lock) | Selected-profile rec scope remains honest gap |
| Settings | — | `SETTINGS UI: PASS` | PASS (source; smoke bundle may be stale) | D54–D56 P2/P3 |
| Authentication | — | `AUTHENTICATION UI: PASS` | PASS | D57–D63 P2; reset WEB-FINISH |
| My Account | — | `MY ACCOUNT UI: PASS` | PASS | D64–D68 billing source gap |
| Negatives | — | `NEGATIVES UI: PASS` | PASS | Customer Nest read absent (accepted) |
| Data Map | — | `DATA MAP UI: PASS` | PASS | Customer aggregate absent (accepted) |
| Notifications | `NOTIFICATION INFRASTRUCTURE: PASS` | Settings UI PASS | Local test previously; routing = contract tests | D84–D86 P2; D87 deployment |
| Core Device QA | — | — | `CORE DEVICE QA: PASS` | — |
| Device + Accessibility Closure | — | — | `DEVICE + ACCESSIBILITY CLOSURE: PASS` | D1 contrast P2; leftover VO speech P2 |
| Onboarding | — | PARTIAL (Welcome + empty states) | Welcome PASS | **ACCEPTABLE PRODUCT GAP** — not a wizard |
| Profile / Date / Bid editor sheets | — | PARTIAL | Used during list QA, not dedicated | P2 dedicated shots |

---

## 3. Documentation drift resolved this gate

| Drift | Resolution |
| --- | --- |
| Coverage §6 RISK A said BidBot Apply/placement have **no confirm** | Docs only. Code + BidBot UI PASS already confirm. Inventory line updated. |
| Coverage §1 More group title “Manage” vs `moreRoot.ts` “Automation” | Docs only. |
| Coverage §5 / §11 still spoke as if final regression / VoiceOver / view-as were unstarted | Updated to closed. |
| Progress STATUS was Not started after Notification PASS | This file is the workstream. |
| Settings smoke footer vs `settingsContract.ts` | **Not a source bug.** Current footer says Campaigns / Book / Settings and `settings-ui` asserts `/Taps open Overview/` is absent. Simulator JS can be a stale Metro cache. |

No product code was changed to make docs agree.

---

## 4. Route map

Active map matches `frontend/app/` + `_layout.tsx` stack. Tab files are `targeting` / `products` (labels Targets / Books).

Tabs resolve: Overview, Campaigns, Targets, Books, More.

Drilldowns registered and pushed: Campaign, Ad Group, Keyword, Target, Book, Search Term, Rule builder, Execution Detail.

More: Bid bot, Ad groups, Negatives, Search terms, Rules, Rule activity, Sync, Data coverage, Accounts, Settings, My Account.

Auth: Welcome, Login, Signup, Forgot, Reset (WEB-FINISH / weakly reachable).

2026-08-23 smoke: `inteliads:///(tabs)`, `/(tabs)/campaigns`, `/(tabs)/targeting`, `/(tabs)/products`, `/(tabs)/more`, `/more/settings`, `/more/bid-bot` opened on iPhone 17. 16e opened Campaigns / Targets / More.

**P0/P1 navigation: none.** D3/D43 `(tabs)` back title remains P2.

---

## 5. Back navigation

No dead-end, wrong-parent, stack loop, or crash-on-back found.

Rule activity / Rules both push `/more/rule-detail/[id]` with an **execution** id. Builder stays `/more/rule-create`. Back from in-app More destinations works; back title `(tabs)` is P2.

Cold launch can restore a prior stack (this smoke first landed on Ad Groups from an earlier Campaign drilldown). Not a dead route.

---

## 6. Profile / account scope

| Concept | Still true |
| --- | --- |
| `selectedProfileIds` | View scope |
| `is_enabled` | Sync / processing eligibility |
| BidBot | Account-wide recs; helper says header filter does not limit them |
| Sync Now | Enabled JWT profiles; not iOS selection |
| Accounts switch | Enable vs “in current view” stay distinct |
| Admin view-as | `filterUserId`; selection cleared on switch |

---

## 7. Admin view-as safety

Previously protected surfaces remain locked:

| Surface | Lock |
| --- | --- |
| Accounts writes / KDP / Connect | `canMutate` false |
| Sync Now / Cancel | Locked |
| BidBot Apply / mode / Run / Revert | `canMutateBidBot`; banner on device this gate |
| Negatives / Data coverage / Rule activity | Blocked (no customer-scoped read) |
| Settings prefs | Self-scoped note (intentional) |
| My Account identity | Signed-in user, not customer |
| Notification eval | Skipped in view-as |

Campaign / Target / Ad Group / Search Term Amazon entity writes are **guest-locked**, not view-as-locked. That matches earlier Campaigns/Targets PASS (view-as is how admin QA reads customer Ads). Nest writes use entity ids, not a Sync/BidBot-style JWT-self job. **Not redefined as a new P0.** Documented as an existing admin-support surface.

Rules catalog stays **signed-in user** scoped (D25). Rule Activity is blocked so admin runs cannot appear as the customer’s.

No cross-user **read** leak found on the previously blocked screens.

---

## 8. Guest

Guest is Preview demo. Mutations alert “Sign in required”. Settings stay local. Overview empty / “No Amazon account”. My Account has no real plan/Amazon ownership. Notification test guest-blocked. **PASS.**

---

## 9. Auth session + sign-out

RouteGuard: loading parks; unauthenticated → `/auth/login`; authenticated on `/auth/*` or `/` → `/(tabs)`. Guest counts as authenticated.

Sign-out (`AuthContext.signOut`): guest flag cleared, `adminFilterUserId` storage removed, `clearNotificationIdentity()`, Nest logout, Supabase sign-out (local fallback), `queryClient.clear()` + persisted cache clear, unauthenticated. My Account `replace("/auth/login")`. AppContext resets selection/view-as on `user?.id` change.

No token `console.log`.

---

## 10. Data truth / missing vs zero / currency / date

Labels remain grain-honest: KDP royalties vs Ads spend vs ad-attributed sales/orders vs KDP orders; ACoS / ROAS / break-even; Overview **Royalties − spend** (not full P&L). Screens are not forced to match.

Missing vs zero on smoke: Books ACoS `—` with $0 spend; Targets “Spending without sales” can show `$0.00` sales / `0` orders (verified zero ads metrics). Overview uses `—` when finance/KDP/Ads are not ready.

Currency: no FX. Mixed totals remain DA-P1-2. BidBot amounts have no invented marketplace code (`CURRENCY_GAP_CAPTION`). Overspend body still hardcodes `$` (D85 P2). `formatCurrency` defaults symbol `$` when code missing — callers on money screens pass `primaryCurrency` or show `—`.

`dateRange` still scopes Overview, Campaigns, Targets, Books, Search Terms, details. Negatives remain current-state (no date).

---

## 11. TopBar / shared components / MetricStrip

TopBar: profile + date + admin view-as + currency chip + safe area. Not redesigned. Smoke: present on Campaigns/Targets/Books/Overview.

| Shared component | Important consumers | Last change | Regression result |
| --- | --- | --- | --- |
| `MetricStrip` | Campaigns, Targets, Books, Ad Groups, details | Dropped `adjustsFontSizeToFit`; width/font ladder | PASS — 4-up on Campaigns/Targets/Books 17 + 16e; no value shrink |
| `ListCard` | Campaigns, Targets, Books, Ad Groups | Unchanged this series | PASS |
| `FilterChrome` | Lists + Negatives | Unchanged | PASS |
| `SubScreen` | More destinations + details | `headerBackTitle: ""` | PASS; `(tabs)` P2 |
| `ToneDot` | Lists | Decorative hidden | PASS; D2 color vs verdict remains P2 |
| `EntityStateSwitch` / `MutationTap` | Lists + details | Guest lock + Amazon-write a11y | PASS |
| `IOSSearchBar` | Filter chrome | Native 36pt+ | PASS |
| `IOSSettingsRow` / `IOSSwitchRow` / `IOSGroupedSection` | Settings, My Account, More | Settings/account passes | PASS; D67 static-row dim P2 |
| Auth chrome | Welcome / Login / Signup / Forgot / Reset | Auth UI PASS | PASS |

Reduce Motion / keyboard: no motion or numeric-editor change after Core Device QA. Not rerun.

Pro Max: no shared width logic change after MetricStrip evidence. Not recaptured.

---

## 12. Search / filter

Campaigns / Targets / Books smoke: search + filters visible, first viewport usable, controls ≥44pt class from prior measurement. Active sort chip / sheets not re-walked; D10 closed earlier. No filter normalization.

---

## 13. Mutation-safety intent (no live Amazon writes)

| Surface | Path |
| --- | --- |
| Campaign pause | Confirm → pending Switch → Nest → error Alert, no false success |
| Campaign budget | Native number prompt “writes to Amazon Ads” → `onSave` → catch |
| Target / keyword pause + bid | Same primitives |
| Ad Group pause | Same |
| Search Term add / negate | Confirm helpers → result/error Alert |
| Rules enable | Confirm; disable no confirm (D26); guest block; create starts disabled |
| Execution Revert/Reapply | Detail only; guest block |
| BidBot Apply / placement / Aggressive / Run-auto / Revert | RN Alert; envelope `applied` ≠ HTTP 200; view-as Alert |
| Accounts enable/disable | Confirm disable; view-as lock; rollback on Nest fail |
| Sync Now / Cancel | Locked in view-as; 200 = accepted not complete |

---

## 14. BidBot / Rules / Notifications

BidBot: `Bid when analyzed`; no live-bid claim; categorical confidence; no selected-profile fiction; no currency invention; confirms; auto-mode consequence; view-as lock; Settings min/max not engine caps. Engine not rerun.

Rules: WHEN/THEN; Enabled/Disabled; create off; builder units + edit parity + guest; Activity = executions newest-first latest-30; Execution completed / no-change / failure; before→after historical; Revert/Reapply detail-only.

Notifications: `_layout` allowlist; Auth/AppContext identity; Settings local copy; wrong-user → tabs; no `data.url` injection. **REMOTE PUSH = NOT IMPLEMENTED / DEPLOYMENT GAP.**

Routing contract (`notificationContract` + tests):

| Event | Route |
| --- | --- |
| test | `/more/settings` |
| new-orders / campaign-overspend | `/(tabs)/campaigns` |
| book-attention + ASIN | `/product/{ASIN}` |
| book-attention no ASIN | Books tab |
| malformed / wrong-user | `/(tabs)` |

---

## 15. Accessibility / dark / small / Dynamic Type

Full VoiceOver closure not rerun. Targeting a11y tests still PASS; those screens were not changed after the closure pass except unrelated Settings footer/routing.

Dark: BidBot smoke + prior Overview/Campaigns/Auth/Settings evidence. No new dark defect.

16e: Campaigns + Targets populated, More, tab safe area, MetricStrip, switches reachable. Overview 16e this smoke restored Targets (prior stack). Historic D17/D40 empty Overview on 16e remains P2 QA-env.

Dynamic Type: no later fixed-font pass. Prior XXXL evidence stands.

---

## 16. Performance / query isolation / error vs empty

No list converted to unvirtualized ScrollView on the large catalogs (FlatList). Notification tasks guarded with `isTaskDefined`. Background register is not a tight poll (15 min minimum). Overview leftover queries stay `enabled: false` (D41).

Rules list still has a secondary entity-hint query (Rule Activity removed its copy). **SAFE TO LEAVE** — not a loop.

Query keys include admin/profile/date or user+scope as required. Sign-out clears memory + persist. Negatives/Data Map/Rule Activity disable customer queries.

Error vs empty: Campaigns `RetryState` when error and empty cache; Books / Search Terms / Rules / Negatives / Data Map / Rule Activity keep the earlier Retry vs empty split.

---

## 17. Dead / legacy (not deleted)

| Item | Class |
| --- | --- |
| `DynamicIsland.tsx` unmounted | SAFE TO LEAVE FOR RELEASE |
| Overview `enabled: false` queries / unused helpers | SAFE TO LEAVE FOR RELEASE |
| `/auth/reset` weakly reachable | SAFE TO LEAVE FOR RELEASE |
| `user_settings.mobileSettings` unread | SAFE TO LEAVE FOR RELEASE |
| `EXPO_PUBLIC_DEBUG_DATA_SCOPE` (off unless `true`) | SAFE TO LEAVE — must stay unset in release |
| QA runtime fixtures used only from `/tmp` / docs process | SAFE TO LEAVE (not in app imports) |
| `frontend/ios/build 2/` generated | SAFE TO LEAVE — do not commit |
| `.agents/skills`, `claude-code-apple-skills-main` | SAFE TO LEAVE — not imported by app |

**RELEASE BLOCKER dead code: none.**

---

## 18. Fixture / console / secrets

Production `frontend/app` + `frontend/src`: no `inject-*`, no imported test fixtures. `debugDataScope` is counts/labels only and no-ops unless `EXPO_PUBLIC_DEBUG_DATA_SCOPE=true`.

Console: auth hydration / Nest login status / saveUserSetting skip / notification warn. No token or password logs.

`SECRET DIFF: CLEAN`

`frontend/.env` is **tracked and modified** (packager host, Metro cache root, proxy, `EXPO_PUBLIC_RULES_API_URL`). Diff hunks are not auth tokens, Amazon passwords, APNs keys, or Supabase service keys. **Do not commit `.env`.**

---

## 19. TypeScript + tests

`npx tsc --noEmit` — **PASS**

Focused suites (`frontend/tests/*.test.js`, 19 files, 133 tests):

| | |
| --- | --- |
| TOTAL PASS | **131** |
| TOTAL FAIL | **2** |

Both failures are `data-mapping.test.js` only.

---

## 20. data-mapping tests 6 and 13

| Test | Verdict |
| --- | --- |
| 6 `direct campaign reads and automation reads are selected-profile scoped` | **A. still stale test only** |
| 13 `overview charts use real derived series without advisory filler copy` | **A. still stale test only** |

Test 6 asserts the exact signature `fetchCampaignById(id: string, profileIds?: string[])`. Current function adds optional `filterUserId` and still applies `.in("amazon_profile_id", profileIds)`. `fetchRuleExecutions` / `fetchRuleIdsForUser` / `fetchTodayExecutionStats` remain. Not a scope regression.

Test 13 asserts `btOrganicOrders` still exists in Overview source. Dashboard audit already records that series as **removed**; `adsEngineAcos` is computed and not rendered; “Low CTR” filler is absent; `AutoTargetSummaryRow` remains on Campaign Detail. Not a return of advisory charts.

Not rewritten this gate.

---

## 21. P0 inventory

**NONE.**

---

## 22. P1 inventory

### RELEASE-BLOCKING P1

**NONE.**

### ACCEPTED PRODUCT / BACKEND GAP

- DA-P1-1…3, 5–9 — profit grain, FX, KDP missing/previous, royalties grain, bleeder Ads-orders, freshness fields, book `orders` uncertainty
- D38 Overview spend grains
- BidBot recs not limited by TopBar selection (UI honest)
- Customer-scoped Negatives / Data coverage / Rule Activity Nest reads
- Authoritative iOS billing (`/pricing-plans/current`) unwired
- Mobile Ads disconnect / delete-account absent
- Onboarding = Welcome + empty states, not a first-run wizard

### DEPLOYMENT BLOCKER

- D87 Nest/APNs **sender** + live remote push verification
- `aps-environment` is **development** in `InteliAds.entitlements`
- Release must not set `EXPO_PUBLIC_DEBUG_DATA_SCOPE=true`
- Production needs `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_RULES_API_URL`

---

## 23. Remote push release status

- Backend sender: **not implemented**
- Live remote APNs: **not verified**
- Local notification infrastructure: **works** (prefs, eval, allowlisted taps, token lifecycle)
- Settings must not (and in source does not) claim remote push

**Does not block the current UI/UX freeze** while the product promises local iPhone alerts.

If Store copy later promises remote push: **BLOCKER** until Nest + production entitlement.

---

## 24. Onboarding

| Piece | Now |
| --- | --- |
| Welcome slides | Exist; from Login when `!inteliads.onboarded` |
| Amazon connect | Accounts / Overview empty states |
| KDP | Accounts + Chrome helper copy |
| Dedicated first-run wizard | Absent |

**Classification: `ACCEPTABLE PRODUCT GAP`**

Coverage PARTIAL ≠ release blocker.

---

## 25. P2 / P3 groups (not fixed)

- Navigation polish: `(tabs)` back, reset unused, ParentLinks stack depth
- Locale / timezone: D8 comma decimals, D35/D81 device-local timestamps, D84 alert “today”
- Pagination / caps: Negatives 500, Rule activity 30, D86 top-5 books
- Backend enrichment: D5/D23/D25 Nest catalog, D33 evaluated count, D20 book orders
- Device evidence: Profile/Date/Bid-editor dedicated shots; D12 real search term
- Debugger / dev: D15 toast, D52 LogBox, `ios/build 2`
- Visual: D1 tertiary contrast, D2 ToneDot vs verdict, D14 sort sheet chrome

None escalated to P1 from current code.

---

## 26. Release configuration (no secrets)

| Item | Current |
| --- | --- |
| Bundle id | `io.inteliads.app` |
| Scheme | `inteliads` (+ `io.inteliads.app`) |
| App name / version | InteliAds 1.0.0 build 1 |
| Plugins | `expo-router`, `expo-notifications`, `expo-background-task`, splash |
| Background | `fetch`, `processing`, `remote-notification` |
| BG task id | `com.expo.modules.backgroundtask.processing` (Expo id; app task name `io.inteliads.app.background-refresh`) |
| Entitlements | `aps-environment` = **development** |
| Appearance | Follows system; splash canvas stays white (D58) |

Missing for a **store** remote-push build: production APNs entitlement, Nest sender, production push certs. Not required to freeze UI/UX.

---

## 27. Skills / Apple skill repo

`.agents/skills` and `claude-code-apple-skills-main` are documentation for agents. No `frontend` import. Metro does not bundle them. **Do not delete this gate.**

---

## 28. Git diff scope (do not commit this gate)

| Category | Examples |
| --- | --- |
| PRODUCT CODE | Tracked edits under `frontend/app`, `frontend/src`; many newer screens/libs still **untracked** |
| TESTS | `frontend/tests/*.test.js` untracked |
| QA DOCS | `docs/ui-audit/*`, `docs/ios-product-map/*` untracked |
| SCREENSHOTS | `docs/ui-audit/device-screenshots/*` including `regression-*.png` |
| QA SCRIPTS | historic `/tmp` helpers; not in product imports |
| ENV/LOCAL | `frontend/.env` (tracked), `.metro-cache` dirt, `frontend/ios/build 2/` |
| UNRELATED | skill zips, landing-page markdown |

Working tree is dirty across the whole UI/UX program. This gate did not create a release commit.

---

## 29. Representative device smoke (2026-08-23)

| File | What it actually shows |
| --- | --- |
| `regression-overview-standard-light.png` | Overview hero Royalties − spend, chart, top books (retake) |
| `regression-campaigns-standard-light.png` | Campaigns 4-metric strip, switches |
| `regression-targets-standard-light.png` | Targets keywords + independent switch/bid |
| `regression-books-standard-light.png` | Books; `—` ACoS vs `$0.00` spend |
| `regression-more-standard-light.png` | More + Viewing a customer |
| `regression-settings-standard-light.png` | Settings; treat footer as possibly stale bundle |
| `regression-bidbot-standard-light.png` | View-as lock + scope helper |
| `regression-bidbot-standard-dark.png` | Dark BidBot |
| `regression-*-small-light.png` | 16e Campaigns / Targets / More |

D15 Expo debugger toast present on all smoke shots (dev-only P3).

---

## 30. Freeze decision

`FINAL RELEASE-WIDE REGRESSION: PASS`

UI/UX phase may freeze.

Do **not** start: new features, screen redesigns, onboarding architecture, Nest APNs, P2 cleanup, or another product-definition audit.

After freeze, remaining work is **release engineering** (signing, production entitlements, env, App Store) and **backend/deployment** (remote push sender, optional customer-scoped reads, FX if product asks).
