# InteliAds iOS — Remaining Screens & Feature Coverage

Date: 2026-08-23  
Source of truth for work after Dashboard / Overview.

Inventory only. Remaining Device + Accessibility Gaps closed 2026-08-23. Product Ads mutation semantics were not changed.

Gates confirmed:

- `DASHBOARD DATA & ARCHITECTURE: PASS` — `IOS_DASHBOARD_DATA_AUDIT.md`
- `DASHBOARD / OVERVIEW UI: PASS` — `IOS_DEVICE_QA.md`
- `ACCOUNTS SAFETY: PASS` — `IOS_ACCOUNTS_SAFETY_AUDIT.md`
- `SYNC DATA & STATE: PASS` — `IOS_SYNC_DATA_AUDIT.md`
- `BIDBOT DATA + SAFETY: PASS` — `IOS_BIDBOT_DATA_SAFETY_AUDIT.md`
- `MORE ROOT: PASS` — More tab hub only. Child UI stays later.
- `ACCOUNTS UI: PASS` — `/more/accounts` presentation. Safety contract unchanged.
- `SYNC UI: PASS` — `/more/sync` presentation. Data contract unchanged.
- `BIDBOT UI: PASS` — `/more/bid-bot` presentation. Safety contract unchanged.
- `SETTINGS UI: PASS` — `/more/settings` presentation. BidBot engine store unchanged.
- `AUTHENTICATION UI: PASS` — Welcome / Login / Signup / Forgot / Reset. Onboarding is still separate.
- `MY ACCOUNT UI: PASS` — `/more/account`. Missing billing truth stays unavailable; billing remains web-only.
- `NEGATIVES UI: PASS` — `/more/negative-targeting`. Browse-only keywords/products; customer view is explicitly unavailable.
- `DATA MAP UI: PASS` — `/more/data-map`. Data coverage diagnostic; no fake profit/zero or unsafe customer scope.
- `RULE ACTIVITY UI: PASS` — `/more/rule-history` recent execution history.
- `DEVICE + ACCESSIBILITY CLOSURE: PASS` — leftover VoiceOver / Ad Groups dark / 16e Targets / mutation-detail labels.
- `NOTIFICATION INFRASTRUCTURE: PASS` — local alerts + safe routing + token lifecycle. Remote push not implemented.
- `FINAL RELEASE-WIDE REGRESSION: PASS` — `IOS_FINAL_RELEASE_REGRESSION.md`. UI/UX phase frozen.
- `INTELIADS IOS RELEASE CANDIDATE: READY` — `IOS_RELEASE_CANDIDATE_READINESS.md`.
- `INTELIADS IOS TESTFLIGHT BUILD: UPLOADED` — `IOS_TESTFLIGHT_BUILD_REPORT.md`. Processing pending. Device smoke not run here.

`REMAINING IOS COVERAGE: MAPPED`

---

## 1. Complete Route Map

Traced from `frontend/app/` file routes **and** `router.push` / `router.replace` / More `href` / RouteGuard / notification `data.url`. Titles are user-visible, not filenames.

```text
/  (index)                          Boot spinner → RouteGuard
│
├── /auth/welcome                   First-launch slides (if !inteliads.onboarded)
├── /auth/login                     Sign in · Amazon LWA browser · Preview demo
├── /auth/signup                    Create account
├── /auth/forgot                    Email reset (completes on web)
├── /auth/reset                     New password (only if a session exists)
│
└── /(tabs)                         Native tab bar
    ├── Overview                    (tabs)/index  · OverviewScreen
    │   ├── /more/accounts          Account chip / empty-state Connect
    │   ├── /more/sync              Sync pill
    │   ├── /(tabs)/products        Top books header
    │   ├── /product/[asin]         Top book row
    │   └── /keyword/[id]           Spending-without-orders row
    │
    ├── Campaigns                   (tabs)/campaigns
    │   └── /campaign/[id]          Campaign Detail
    │       ├── /more/ad-group/[id] Ad groups on campaign
    │       ├── /keyword/[id]
    │       ├── /target/[id]
    │       └── /more/search-terms  Search terms on campaign
    │
    ├── Targets                     (tabs)/targeting
    │   ├── /keyword/[id]           Keyword Detail
    │   ├── /target/[id]            Product / auto / category target
    │   └── /campaign/[id]          Campaign chip on row
    │
    ├── Books                       (tabs)/products
    │   └── /product/[asin]         Book Detail / Book Campaigns
    │       └── /campaign/[id]
    │
    └── More                        (tabs)/more
        ├── banner → /more/account
        ├── Automation
        │   ├── /more/bid-bot
        │   ├── /more/ad-groups → /more/ad-group/[id]
        │   ├── /more/negative-targeting
        │   ├── /more/search-terms → /search-term/[id]
        │   ├── /more/automation → /more/rule-create · /more/rule-history
        │   └── /more/rule-history → /more/rule-detail/[id]
        ├── Data
        │   ├── /more/sync
        │   ├── /more/data-map
        │   └── /more/accounts
        └── App
            ├── /more/settings
            └── /more/account
```

Non-route overlays (not Expo routes):

| Surface | Host | Reach |
| ------- | ---- | ----- |
| Profile / admin-customer sheet | `TopBar` | Campaigns, Targets, Books, many `SubScreen`s |
| Date-range sheet | `DateRangeControl` | Same + Data Map + Search Terms + details |
| Bid / budget editor | `BidBudgetEditor` | Campaigns, Campaign Detail, Targets, Keyword, Target |
| Pause confirm | `EntityStateSwitch` | Campaign / keyword / target / ad group |
| Splash video | `SplashVideo` in root layout | Cold start |

Web-only file: `frontend/app/+html.tsx` (Expo web HTML shell). Not an iOS screen.

---

## 2. Active User-Facing Screens

| Route | Title | Parent / reach | Active | Mutates | Money / Ads | QA status | Device evidence | Completed workflow |
| ----- | ----- | -------------- | ------ | ------- | ----------- | --------- | --------------- | ------------------ |
| `(tabs)/index` | Overview | Tab | ACTIVE | Date range write | Read + nav | PASS — DEVICE VERIFIED | Yes (std/small/large, dark, DT) | Dashboard data + UI |
| `(tabs)/campaigns` | Campaigns | Tab | ACTIVE | Pause / budget | Yes | PASS — DEVICE VERIFIED | Yes | Campaigns List |
| `campaign/[id]` | Campaign | Campaigns / Books / Targets | ACTIVE | Pause / budget / placements | Yes | PASS — DEVICE VERIFIED | Std + small + large + dark + DT; VO live tree | Campaign Detail |
| `(tabs)/targeting` | Targets | Tab | ACTIVE | Bid / pause | Yes | PASS — DEVICE VERIFIED | Combined row spoken; 16e populated | Targets List |
| `keyword/[id]` | Keyword | Targets / Campaign / Overview / Ad group | ACTIVE | Bid / pause | Yes | PASS — DEVICE VERIFIED | Std light+dark; VO live tree | Targeting Detail |
| `target/[id]` | Target | Targets / Campaign / Ad group | ACTIVE | Bid / pause | Yes | PASS — DEVICE VERIFIED | Auto Substitutes dark + VO live tree; ASIN light remains | Targeting Detail |
| `(tabs)/products` | Books | Tab / Overview | ACTIVE | No | Read | PASS — DEVICE VERIFIED | Yes | Books List |
| `product/[asin]` | Book | Books / Overview | ACTIVE | No | Read | PASS — DEVICE VERIFIED | Std + small + dark + DT | Book Detail |
| `(tabs)/more` | More | Tab | ACTIVE | No | Nav hub | **UI PASS** | `more-*.png` (prior More Root pass) | More hub only |
| `more/bid-bot` | Bid bot | More | ACTIVE | Run / apply / revert / auto settings | Yes | **UI PASS** · **DATA + SAFETY PASS** | `bidbot-*.png` | Contract unchanged |
| `more/ad-groups` | Ad Groups | More | ACTIVE | Pause | Yes | PASS — DEVICE VERIFIED | Empty Active + dark/XXXL **fixture** | Ad Groups List |
| `more/ad-group/[id]` | Ad Group | Ad groups / Campaign | ACTIVE | Pause children | Yes | PASS — DEVICE VERIFIED | Std + sizes + dark + DT; VO live tree | Ad Group Detail |
| `more/negative-targeting` | Negative Targeting | More | ACTIVE | No (read list) | Read | **UI PASS** | `negatives-*.png` | Browse-only keyword/product negatives |
| `more/search-terms` | Search Terms | More / Campaign / Ad group | ACTIVE | Harvest / negate | Yes | PASS — DEVICE VERIFIED | Yes | Search Terms List |
| `search-term/[id]` | Search term | Search terms | ACTIVE | Harvest / negate | Yes | PASS — DEVICE VERIFIED | Fixture + dark + VO live tree (D12 real term still P2) | Search Term Detail coverage |
| `more/automation` | Rules | More | ACTIVE | Enable / disable | Yes | PASS — DEVICE VERIFIED | Yes | Rules List |
| `more/rule-create` | New rule / edit | Rules | ACTIVE | Create (off) / save / delete | Yes | PASS — DEVICE VERIFIED | Yes | Rule Builder |
| `more/rule-history` | Rule activity | More / Rules | ACTIVE | No (opens execution) | Read → mutate on detail | **UI PASS** | `rule-activity-*.png` | Recent execution history only |
| `more/rule-detail/[id]` | Execution | Rule activity | ACTIVE | Revert / reapply | Yes | PASS — DEVICE VERIFIED | Summary yes; populated entities blocked | Rule Execution Detail |
| `more/sync` | Sync | More / Overview pill | ACTIVE | Trigger / cancel sync | Backend jobs | **UI PASS** · **DATA CONTRACT PASS** | `sync-*.png` | Contract unchanged |
| `more/data-map` | Data coverage | More | ACTIVE | Date range only | Read / diagnostic | **UI PASS** | `data-map-*.png` | Mixed setup + selected-period coverage |
| `more/accounts` | Amazon Accounts | More / Overview chip | ACTIVE | Enable, nickname, KDP link/unlink, Connect | Connectivity | **UI PASS** · **SAFETY PASS** | `accounts-*.png` | Safety unchanged. No mobile disconnect |
| `more/settings` | Settings | More | ACTIVE | Local alert prefs | Config / alerts | **UI PASS** | `settings-*.png` | Unused min/max/budget editors removed |
| `more/account` | My Account | More banner + App | ACTIVE | Sign out | Session | **UI PASS** | `my-account-*.png` | Identity / plan truth / web billing / session |
| `auth/welcome` | InteliAds slides | Login if first launch | ACTIVE | Sets `inteliads.onboarded` | No | **UI PASS** | `auth-welcome-*.png` | Auth entry only; not full onboarding |
| `auth/login` | Sign in | Unauthenticated default | ACTIVE | Session / guest | Session | **UI PASS** | `auth-login-*.png` | Guest = Preview demo |
| `auth/signup` | Create account | Welcome / Login | ACTIVE | Creates user | Session | **UI PASS** | `auth-signup-*.png` | 6-char rule; confirmation copy |
| `auth/forgot` | Forgot password | Login | ACTIVE | Sends email | Session | **UI PASS** | `auth-forgot-standard-light.png` | Web-finish |
| `auth/reset` | New password | Weakly reachable; email goes to **web** | WEB-FINISH / WEAKLY REACHABLE | Password update if session (RouteGuard bounces authed users) | Session | **UI PASS** (web-copy) | `auth-reset-standard-light.png` | Do not rebuild reset |
| `index` | Checking session | Cold start | ACTIVE | No | No | PASS (auth gate) | Splash + spinner label | Boot |
| Profile sheet | Amazon Profiles | TopBar | ACTIVE | Local selection + admin `filterUserId` | Scope | PARTIAL | Used during list QA, not dedicated | Shared |
| Date sheet | Date range | TopBar / SubScreen | ACTIVE | Shared `dateRange` | Query scope | PARTIAL | Same | Shared |
| Bid / budget editor | Alert prompt | Entity screens | ACTIVE | Amazon writes | Yes | PARTIAL | Used in Campaigns/Targets QA | Shared |

---

## 3. Legacy / Internal / Dead

| Item | Class | Notes |
| ---- | ----- | ----- |
| `+html.tsx` | WEB ONLY | Expo web document. Not in the iOS tab map. |
| `DynamicIsland.tsx` | DEAD/UNREFERENCED | Defined; **not mounted**. Matrix already called this unused. Do not delete this pass. |
| Overview leftover queries / helpers | DEAD (in-file) | `enabled: false` + unused helpers in `(tabs)/index.tsx` (D41). Not routes. |
| Admin customer list | INTERNAL ADMIN (sheet, not a route) | `TopBar` profile sheet when `fetchNestUsers` succeeds. Persists `inteliads.adminFilterUserId`. |
| `auth/reset` | ACTIVE but unused by email | Reset email `redirectTo` is `https://dashboard.inteliads.io/reset-password`. In-app screen only works if a session already exists. |
| Chrome KDP Helper | WEB/EXTENSION ONLY | Not a mobile route. See §KDP. |
| Web admin routes | WEB ONLY BY DESIGN | Users, activity-logs, infra, blog, discounts, admin-rules — not in `frontend/app/`. |

No Expo route under `frontend/app/` is completely unreferenced except the unused `DynamicIsland` **component**. Do not delete routes this pass.

---

## 4. Completed QA

Evidence in `IOS_SCREEN_QA_MATRIX.md` + `IOS_DEVICE_QA.md`. Do not treat memory as PASS.

| Area | Gate |
| ---- | ---- |
| Core Device QA | `CORE DEVICE QA: PASS` |
| Campaigns List | PASS |
| Targets List | PASS — combined row spoken 2026-08-23 |
| Campaign Detail | PASS — VO live tree 2026-08-23 |
| Ad Groups List | PASS — dark + XXXL fixture; Nest catalog still D5 |
| Ad Group Detail | PASS — VO live tree 2026-08-23 |
| Keyword / Target / Search-term Detail | PASS — VO live tree 2026-08-23; search-term fixture (D12) |
| Books List | `BOOKS LIST: PASS` |
| Book Detail | `BOOK DETAIL: PASS` |
| Search Terms List | `SEARCH TERMS LIST: PASS` |
| Rules List | `RULES LIST: PASS` |
| Rule Builder | `RULE BUILDER: PASS` |
| Rule Execution Detail | `RULE EXECUTION DETAIL: PASS` |
| Dashboard data | `DASHBOARD DATA & ARCHITECTURE: PASS` |
| Dashboard / Overview UI | `DASHBOARD / OVERVIEW UI: PASS` |
| My Account | `MY ACCOUNT UI: PASS` |
| Negatives | `NEGATIVES UI: PASS` |
| Data Map | `DATA MAP UI: PASS` |

---

## 5. Remaining QA

No remaining UI/UX workstream. `FINAL RELEASE-WIDE REGRESSION: PASS`.

Still outside this program:

1. Store / Nutrition Label / XCUITest.
2. Onboarding remains PARTIAL (Welcome slides + empty states) — **ACCEPTABLE PRODUCT GAP**.
3. Remote APNs sender remains **BLOCKED BY DEPLOYMENT** (not a UI stream).

Profile / Date / Bid-editor dedicated shots stay Partial P2. Do **not** open a standalone Shared Components workstream.

---

## 6. Mutation Risk

### RISK A — HIGH

Can change Ads, budgets, bids, rules, sync jobs, or account connectivity.

| Surface | Writes |
| ------- | ------ |
| Bid bot | `runBidEngine`, `applyBidRecommendations` (RN Alert confirm), `applyPlacementRecommendations` (RN Alert confirm), `revertBidApplyLog` (confirm), `updateBidEngineSettings` including auto mode (Aggressive + Run-while-auto warn) |
| Accounts | `toggleAmazonProfile`, `updateProfileNickname`, `setKdpLinkedProfiles` (replaces all links), `unlinkKdpProfile`, `fetchAmazonConnectUrl` + browser |
| Sync | `triggerSync`, `cancelSync` |
| Rules list / builder / execution | Enable (confirm), disable (no confirm), delete rule (confirm), create `enabled: false`, revert/reapply execution |
| Campaigns / Targets / Keyword / Target / Ad group | Pause (confirm), bid/budget editor (writes Amazon) |
| Search terms / Search-term detail | Harvest / negate (confirm) |
| Profile sheet | Local `selectedProfileIds` + admin `filterUserId` (changes what every list shows; admin is view-as) |

### RISK B — MEDIUM

| Surface | Writes |
| ------- | ------ |
| Settings | Notification prefs (local + permission + best-effort `user_settings.notifications`); no `mobileSettings` write |
| My Account | Sign out (confirm) |
| Login / Signup / Forgot / Reset / Guest | Session |
| Welcome | `inteliads.onboarded` |
| Date sheet | Shared `dateRange` (query scope, not Amazon) |

### RISK C — LOW

Overview (read + date), Books, Book Detail, Data Map (read), Negatives (read), More root (nav), splash.

---

## 7. Mobile / Web Parity

Compared to `docs/ios-product-map/01-WEB-APP-INVENTORY.md` and `04-IOS-FEATURE-PARITY.md` **only for features that exist in product code**.

### Full mobile parity (seller daily path exists)

Email login, signup, guest/demo, campaign list + pause + budget, targeting keywords/ASINs/auto + bid/pause, search terms + harvest/negate, books list + book detail, rules list + toggle + subset builder, rule execution revert/reapply, BidBot recs/apply/run/auto/activity/placements (present, not QA’d), sync trigger/logs, profile picker, admin view-as (TopBar), date range, plan-gate copy (`Manage your plan at inteliads.io`).

### Partial mobile parity

| Feature | Gap |
| ------- | --- |
| Amazon LWA login | Browser OAuth; button hides on failure |
| Password reset | Mobile sends mail; **finish on web** |
| Connect Amazon | Browser; empty-state still says connect at inteliads.io |
| Home / Overview | Live tree is profit + books + bleeders; web North Star attention stack is mostly dead/`enabled: false` |
| Campaign / ad-group detail tabs | Nested lists exist; not full web tab set (product ads, history completeness) |
| BidBot on targeting rows | Recs live on Bid bot screen only |
| Advanced targeting filters | Perf chips / filter sheet subset |
| Rule builder | Subset; unsupported combos “Edit on web”; create stays off |
| Rule activity | List redesigned as recent execution history; web still has harvest/cooldown tabs |
| Settings | Local alert prefs; Appearance Follows system (not tappable); unused min/max editors removed; no Face ID |
| Notifications | Local engine + optional token upsert; **no Nest push API** |
| AMS intraday | Shown on Sync only if `ams_messages` query succeeds |
| Onboarding | Welcome slides only; connect Amazon / KDP / first sync are empty states |
| Data Map | Mobile coverage screen; web inventory does not list an equivalent sidebar item as a first-class daily tool |
| My Account plan | Metadata-only; missing plan/status show **Unavailable**. Authoritative `/pricing-plans/current` is not wired to iOS. |

### Web-only by design

Stripe `/billing` `/pricing`, IAP/StoreKit, admin infra/users/blog/Clarity/activity-logs/discounts/admin-rules, rule assistant, campaign create (not on web either), Sign in with Apple, Chrome KDP collector.

### Missing mobile (exists in product, operators reasonably need)

| Need | Notes |
| ---- | ----- |
| Honest account disconnect | Connect exists; **no disconnect / revoke Ads** on mobile |
| Delete InteliAds account | **NOT PRESENT** |
| BidBot scoped to selected profiles | Status uses `adminFilterUserId` only; recs/apply are **not** passed `selectedProfileIds` |
| Remote/push alerts to a specific entity | Local taps now allowlisted. Remote sender still absent |
| Bulk bid / pause | Web Targeting; not on mobile |
| Set list price on a book | Web PATCH; not on mobile |
| KDP collect from iPhone | Chrome extension only (honest) |

### Not appropriate for mobile

Hidden WebView KDP scrape, continuous Chrome-style helper, admin blog/infra, Stripe IAP unless product later asks.

---

## 8. P0 / P1 Backlog (deduped)

No new product P0 from device QA. Dashboard P0 (missing KDP as `$0`) is resolved in the data + UI passes.

| ID | Screen | Issue | P0/P1 | Type | Can fix in mobile | Requires backend |
| -- | ------ | ----- | ----- | ---- | ----------------- | ---------------- |
| DA-P1-1 | Overview | “Profit” is royalties − spend, not accounting P&L | P1 | PRODUCT / DATA | Label already “Royalties − spend”; do not invent expenses | Yes for full P&L |
| DA-P1-2 | Overview | No FX; mixed currencies one total | P1 | DATA | No — do not invent FX | Yes |
| DA-P1-3 | Overview | Admin previous KDP `$0` treated as missing | P1 | FRONTEND DATA | Possible later; not this pass | Partial |
| DA-P1-4 | Campaigns | Nest profile IDs not remapped like Overview bootstrap | P1 | QUERY SCOPE | Yes (query) | No if remap is client-side |
| DA-P1-5 | Overview vs Books | Account-level vs book-level royalties | P1 | PRODUCT | No — do not force-match | Yes / product |
| DA-P1-6 | Overview | Bleeder filter is Ads orders | P1 | PRODUCT | Title already “Spending without orders” | No |
| DA-P1-7 | Overview / Sync | Unused Nest `cachedAt` / `stale` / `partialFailures` | P1 | DATA / FRESHNESS | Display only after contract | Prefer backend meaning |
| DA-P1-8 | Books / Overview | Nest book `orders` grain UNCERTAIN | P1 | DATA | No | Yes |
| DA-P1-9 | Overview | Seller top-books no-KDP fallback can look like −spend P&L | P1 | FRONTEND DATA | After contract | No |
| D38 | Overview | Hero Ad spend (`campaign_metrics`) vs bleeder keyword spend | P1 | DATA | No — do not force-match | Grain documented |
| N-P1 | Notifications | Local alerts deep-link to Overview / `data.url`, not a specific entity | P1 | PRODUCT | **Resolved 2026-08-23** — allowlisted event routes; wrong user cannot open the entity. Remote sender still absent | Remote push needs Nest |
| INV-ACC-1 | Accounts | Dual write + missing disable confirm | P1 | SAFETY | **Resolved 2026-08-22** — confirm + Ads-id writes + view-as lock. Disconnect still web-only | Disconnect API exists on web only |
| INV-BB-1 | Bid bot | Apply bids/placements have **no** confirmation; auto mode can write Amazon | P1 | SAFETY | **Resolved 2026-08-22 BidBot UI** — RN Alert confirms; Aggressive + Run-while-auto warn. Engine unchanged | Engine semantics |
| INV-SET-1 | Settings vs Bid bot | `mobileSettings` min/max/cooldown vs BidBot `targetAcos`/`autoMode` — two stores | P1 | DATA | **Resolved 2026-08-22 Settings UI** — unused iPhone guardrail editors removed. BidBot min/max stay display-only `user_settings.min_bid`/`max_bid`. Stores not merged | Engine caps still web-only |
| INV-ACCT-1 | My account | Plan defaulted to **Pro**; Status was hardcoded **Active** | P1 | PRODUCT | **Resolved 2026-08-22 My Account UI** — missing is Unavailable; metadata is labeled metadata-only | Authoritative billing source still not wired to iOS |
| INV-NEG-1 | Negatives | Direct Supabase reads ignored admin view-as and global placeholder data could show stale/false-empty rows after a scope change | P1 | QUERY SCOPE | **Resolved 2026-08-22 Negatives UI** — customer view blocks honestly; keys include user/scope/profiles; no previous-data carry-over | Customer-scoped Nest negatives read is still absent |
| INV-DM-1 | Data map | Hero said “Net profit”; missing KDP could read as `$0` / negative net; customer scope was unsafe | P1 | DATA / UI | **Resolved 2026-08-22 Data Map UI** — no P&L hero, source-specific nullability/labels, partial states, customer view blocked | No customer-scoped aggregate; no KDP import freshness |

---

## 9. P2 / P3 Backlog (groups)

Do not clean these in the next workstream.

**Global / shared**

- D1 `text_tertiary` contrast
- D8 locale comma decimals
- D15 / D39 Expo debugger toast over tab bar (dev-only)
- Theme / Large Content Viewer on stack titles

**Navigation**

- D3 / D31 back title `(tabs)`
- `rule-create` vs `rule-detail/[id]` naming (builder vs execution)
- `auth/reset` unused by email flow
- Profile sheet vs Amazon Accounts (two different jobs)

**Data semantics** (already documented)

- D4 campaign daily vs list spend
- D5 / D6 ad groups Nest `filterUserId`
- D20 book vs child orders
- D23 search terms no Nest filterUserId
- D25 rules list logged-in `user.id`
- D32–D35 execution data gaps
- D18 / D19 / D21 book fields

**Device QA leftovers**

- D13 combined Targets row — **closed 2026-08-23**
- Ad Groups list dark / XXXL — **closed with runtime fixture**; real Nest catalog still D5
- Keyword / Target / Search-term / Campaign / Ad group VO — **closed 2026-08-23** (live tree; Targets spoken)
- D17 / D40 16e / Max Overview / Books populated Nest session (Targets 16e closed)
- D12 real search-term row
- Pull-to-refresh (matrix leftover)
- Welcome / splash Dark Mode P2
- Dedicated Profile / Date / Bid-editor shots

**Individual screen polish**

- D2 ToneDot vs verdict
- D7 / D9 truncation / funnel precision
- D14 / D24 empty sort sheets
- D26 disable-rule no confirm (product-correct)
- D28 builder discard
- D29 / D30 cooldown / edit-on-web
- D37 Rule activity redesigned (resolved this pass)
- Settings Appearance / KDP rows stay informational (now labeled Follows system / Profit source)
- BidBot unused type fields (`engineScore`, `cooldownHours`, `watchdogEnabled`, …)

**Dev-only artifacts**

- D15 toast, D16 leftover Alert across `openurl`, D41 dead Overview queries, `DynamicIsland` unused

---

## 10. Recommended Remaining Sequence

Priority: mutation/safety → frequency → missing QA → revenue → cross-screen → device uncertainty → cosmetic.

### 1. Accounts State + Mutation Contract Audit — DONE

`ACCOUNTS SAFETY: PASS` — `IOS_ACCOUNTS_SAFETY_AUDIT.md`. UI QA remains later in this list.

### 2. Sync Data / State Contract Audit — DONE

`SYNC DATA & STATE: PASS` — `IOS_SYNC_DATA_AUDIT.md`. Sync UI QA is a separate gate.

### 3. BidBot Data / Safety Contract Audit — DONE

`BIDBOT DATA + SAFETY: PASS` — `IOS_BIDBOT_DATA_SAFETY_AUDIT.md`. BidBot UI is a separate gate (`BIDBOT UI: PASS`).

### 4. More Root — COMPLETE UI QA — DONE

`MORE ROOT: PASS`. Hub only. Child screens stay PARTIAL. Do **not** mark Accounts / Sync / BidBot UI PASS because More navigation works.

### 5. Accounts — COMPLETE UI QA — DONE

`ACCOUNTS UI: PASS`. Do **not** reopen enable/disable/KDP mutation semantics. Do **not** add mobile Ads disconnect.

### 6. Sync — COMPLETE UI QA — DONE

`SYNC UI: PASS`. Ads-only status, Sync now ≠ completion, loading ≠ syncing, view-as locked. Do **not** reopen Nest sync/cancel semantics.

### 7. BidBot — COMPLETE UI QA — DONE

`BIDBOT UI: PASS`. Snapshot ≠ live; Apply / placement / Aggressive / Run-auto confirm; view-as locked; min/max not sold as engine caps. Do **not** reopen engine semantics.

### 8. Settings — COMPLETE UI QA — DONE

`SETTINGS UI: PASS`. Local alerts only. Unused min/max/cooldown/daily-budget editors removed. BidBot engine store unchanged. Do **not** merge `mobileSettings` into `min_bid`.

### 9. Authentication (Welcome / Login / Signup / Forgot / Reset) — COMPLETE UI QA — DONE

`AUTHENTICATION UI: PASS`. Login/signup/forgot match backend + web-finish reset. Guest is Preview demo (empty Overview, not sample data). RouteGuard parks on loading and bounces authenticated users off `/auth/*`. Welcome Ionicons replaced locally. Do **not** mark Onboarding PASS. Do **not** add Sign in with Apple.

### 10. My Account — COMPLETE UI QA — DONE

`MY ACCOUNT UI: PASS`. Signed-in identity stays self-scoped during admin view-as. Missing plan/status are Unavailable; metadata plan stays metadata-only. Billing opens the web dashboard. Guest is Preview demo, not a fake account. Sign-out clears local account/view/query state; the live destructive action was not confirmed on the populated QA session. No delete-account UI was invented.

### 11. Negatives — COMPLETE UI QA — DONE

`NEGATIVES UI: PASS`. Browse-only negative keywords and product targets. Human exact/phrase/ASIN/category labels, campaign/ad-group scope, local search, distinct loading/error/empty states, FlatList, and explicit latest-500 cap. Direct customer reads are unavailable on iPhone, so admin view-as blocks instead of lying. Search Terms and Rules were not changed.

### 12. Data Map — COMPLETE UI QA — DONE

`DATA MAP UI: PASS`. Renamed user-facing title to Data coverage. Current setup and selected-period data are separated. Ads spend/sales/orders and imported KDP royalties/orders stay source-specific; missing KDP is unavailable, not zero. Counts fail independently. View-as blocks because no safe customer-scoped aggregate exists.

### 13. Rule activity — COMPLETE UI QA — DONE

`RULE ACTIVITY UI: PASS`. Recent execution history for selected profiles. Rows are executions, not Rules. Status labels stay shared with Execution Detail. Completed / no-change / failed / partial / running / reapplied stay distinct. Changed and failed counts come from stored `entities` / `errors_count`. Evaluated is not invented. Current WHEN/THEN is not reconstructed. View-as is blocked. Revert/Reapply stay on Execution Detail. The latest-30 window is labeled recent, not complete history.

### 14. Remaining device gaps on completed screens — DONE

`DEVICE + ACCESSIBILITY CLOSURE: PASS`. Targets combined row spoken. Ad Groups dark + XXXL fixture. Mutation-sensitive details on the live tree. 16e Targets populated via safe session.

### 15. Notification infrastructure (not a screen) — DONE

`NOTIFICATION INFRASTRUCTURE: PASS`. Local evaluator, prefs, permission, token lifecycle, and allowlisted taps. No Nest sender. Live APNs is BLOCKED BY DEPLOYMENT.

### 16. Final release-wide regression — DONE

`FINAL RELEASE-WIDE REGRESSION: PASS` — `IOS_FINAL_RELEASE_REGRESSION.md`. UI/UX frozen. Store / Nutrition Label / XCUITest remain out of this inventory.

---

## 11. Final Release QA Requirements

`FINAL RELEASE-WIDE REGRESSION: PASS` (2026-08-23). Representative smoke + contract/tests closed the UI/UX freeze.

Still out of this program (not blockers for the freeze):

- Store / Nutrition Label / XCUITest
- Remaining VoiceOver *speech* on screens that only have live-tree labels
- D17/D40 16e populated Overview session
- Dedicated Profile / Date / Bid-editor shots
- Remote APNs sender
- Keep: no Chrome KDP claim; billing web-only; no Data coverage “profit”; Overview stays `Royalties − spend`

---

## More root entries (actual UI)

Banner (not in `GROUPS`): email or “Guest” · “InteliAds account” · → `/more/account`

| LABEL | ROUTE | PURPOSE | ACTIVE | QA STATUS | PRIORITY | RISK |
| ----- | ----- | ------- | ------ | --------- | -------- | ---- |
| Bid bot | `/more/bid-bot` | Recs, apply, auto, activity | ACTIVE | PASS — DEVICE VERIFIED | Done | A |
| Ad groups | `/more/ad-groups` | Ad group list | ACTIVE | PASS — DEVICE VERIFIED | Done (Nest catalog D5) | A (pause) |
| Negative targeting | `/more/negative-targeting` | Browse keyword + product negatives | ACTIVE | PASS — DEVICE VERIFIED | Done | C |
| Search terms | `/more/search-terms` | Search term list | ACTIVE | PASS — DEVICE VERIFIED | Done | A (actions) |
| Rules | `/more/automation` | Rule catalog | ACTIVE | PASS — DEVICE VERIFIED | Done | A |
| Rule activity | `/more/rule-history` | Execution list | ACTIVE | PASS — DEVICE VERIFIED | Done | C→A on detail |
| Sync | `/more/sync` | Ads sync status + trigger | ACTIVE | PASS — DEVICE VERIFIED | Done | A |
| Data coverage | `/more/data-map` | Ads / KDP availability and setup coverage | ACTIVE | PASS — DEVICE VERIFIED | Done | C (read-only) |
| Amazon accounts | `/more/accounts` | Profiles + KDP links | ACTIVE | PASS — DEVICE VERIFIED | Done | A |
| Settings | `/more/settings` | Local alerts + app info | ACTIVE | PASS — DEVICE VERIFIED | Done | B |
| My account | `/more/account` | InteliAds identity + web billing + session | ACTIVE | PASS — DEVICE VERIFIED | Done | B |

Not on More (do not invent): BidBot+ standalone, Notifications screen, KDP Helper, Support, Privacy, Legal, Billing, Data reset.

More root UI QA is **PASS** (`/(tabs)/more`). Child destination gates above match later dedicated UI passes. Ad Groups Nest catalog emptiness remains D5.

---

## Settings

`SETTINGS UI: PASS`.

**One grouped surface** (`/more/settings`). No child settings routes.

- Notifications: New orders / Book needs attention / Campaign overspending + threshold vs **campaign** daily budgets + local test on this iPhone
- Ads: navigation to Bid bot only. This screen does **not** edit min/max/cooldown/daily budget
- Profit data: informational KDP royalties (not tappable; iPhone does not collect)
- App: Appearance = Follows system (not tappable)

No privacy, legal, help, Face ID, or account-deletion section here. Logout is on My Account.

---

## Accounts / profile management

| Surface | Job |
| ------- | --- |
| `/more/accounts` | Connect Amazon (browser), per-profile **enable Switch** (`toggleAmazonProfile` + `setSelectedProfileIds`), nickname, KDP list/link/unlink |
| TopBar profile sheet | Multi-select **which profiles are in context** (`toggleProfile` / Select all); admin customer list (`setAdminFilterUserId`) |
| Overview chip | Pushes **Accounts**, not the sheet |
| Persistence | `inteliads.selectedProfiles`, `inteliads.adminFilterUserId`; cleared on user change / sign-out |
| Currency | `primaryCurrency` = plurality of selected `currency_code` (Dashboard audit: no FX) |
| Reconnect | Connect Amazon again via LWA URL |
| Disconnect Ads | **NOT PRESENT** |
| KDP | Link/unlink only; collect is Chrome (`Connect KDP with the Chrome extension at inteliads.io.`) |
| Guest | Mutations blocked |

---

## Sync

`SYNC DATA & STATE: PASS` — `IOS_SYNC_DATA_AUDIT.md`.

`SYNC UI: PASS` — `/more/sync` presentation. Nest sync/cancel semantics unchanged.

`/more/sync` · `fetchSyncOverview` + `fetchSyncStatus` (poll 4s while in progress; `filterUserId` when viewing a customer) + optional `ams_messages`.

Shown: Amazon Ads status + Sync now or Cancel, selected-profile latest rows, window caption (not giant Records cards), recent sessions (self only), Marketing Stream if the table query succeeds.

Sync Now = Nest manual Ads job for **enabled** JWT profiles. Not iOS selection. Not KDP. Not AMS. HTTP 200 = accepted, not complete.

View-as: mutations locked. Chrome / helper remains KDP collection.

Background notification task is separate (`notifications.ts`) and must not be described as “iPhone keeps Ads+KDP fresh.”

---

## BidBot

`BIDBOT DATA + SAFETY: PASS` — `IOS_BIDBOT_DATA_SAFETY_AUDIT.md`.

`BIDBOT UI: PASS` — `/more/bid-bot` presentation. Nest engine / apply / stale guards unchanged.

Single route `/more/bid-bot` with in-screen tabs: **Working** / **Settings** / **About**.

Writes locked in admin view-as. Reads always send `filterUserId`. Apply HTTP 200 is not success unless the envelope `applied` count matches.

`selectedProfileIds` still does not scope recs (no profile on DTO) — UI says so. Settings `mobileSettings` is not the engine `min_bid` store — min/max are display-only. Apply / placement / Aggressive / Run-while-auto now confirm.

---

## KDP Helper

| Capability | Status |
| ---------- | ------ |
| Native KDP session / cookie capture | NOT PRESENT |
| WebView (`react-native-webview` is a dependency; **zero source imports**) | NOT PRESENT |
| SecureStore for Amazon cookies | NOT PRESENT (SecureStore used for Nest tokens) |
| Royalties **read** on Overview / Books | IMPLEMENTED (server data) |
| KDP account list + link to Ads profiles | IMPLEMENTED on Accounts |
| Trigger KDP collect from iOS | NOT PRESENT |
| Chrome extension collector | WEB/EXTENSION ONLY |
| Background royalty scrape | NOT PRESENT (and must not be claimed) |

Classification: **PARTIAL** mobile (consume + link) + **WEB/EXTENSION ONLY** collect.

---

## Notifications

### Infrastructure — PASS (local) / TOKEN REGISTRATION ONLY (remote)

`NOTIFICATION INFRASTRUCTURE: PASS` — `IOS_NOTIFICATION_INFRASTRUCTURE_AUDIT.md`.

Local `runAlertCheck` for New orders (Ads `campaign_metrics`), Book needs attention (top-5 ACoS vs break-even), Campaign overspending (sum of enabled daily budgets). Test is local. Token: native APNs stored locally + best-effort `device_push_tokens`. **No Nest sender.**

### UI / settings — PASS (Settings UI 2026-08-22; footer routing copy 2026-08-23)

Settings switches + local test. Footer says local / not remote push. Taps: Campaigns / Book / Settings, not Overview-only. Opening iOS Settings if denied.

### Deep linking — PASS (allowlist)

Event + `userId` + optional ASIN. Arbitrary `data.url` rejected. Wrong user → tabs. Auth required.

Do not treat a Settings toggle as proof that remote push works.

---

## Authentication

`AUTHENTICATION UI: PASS` (2026-08-22).

| Screen | Status |
| ------ | ------ |
| Login | Email/password, optional Amazon LWA, guest, forgot, signup. Redirects to Welcome if not onboarded. |
| Signup | Email + confirm; 6-character rule; confirmation vs created copy |
| Forgot | Email; generic success; finish on web |
| Reset | WEB-FINISH / WEAKLY REACHABLE / LEGACY. In-app form needs a session; RouteGuard bounces authed users to tabs. |
| OAuth | Amazon browser only. No Apple / Google. Do not add a fake Apple button. |
| Guest | `enterGuestMode` → authenticated without session; mutations blocked; Overview empty |
| Session restore | `getSession` + `getUser`; 8s timeout; guest flag; SplashGate waits on `loading` |
| Logout | My Account confirm → `nestLogout` + Supabase signOut — **not** this pass |

Onboarding (Welcome slides + later Amazon/KDP connect) remains **PARTIAL**.

---

## Onboarding

**PARTIAL / mixed into empty states.**

- First launch: Welcome 3 slides → Create account or Sign in
- Connect Amazon: Accounts / Overview empty
- Select profiles: TopBar + Accounts
- Connect KDP: Accounts empty + Chrome copy
- Notification permission: when a Settings alert is turned on
- Initial sync: Sync screen / pill — not a wizard
- No `/setup/status` tour on mobile

Do not invent a new onboarding flow in the next pass.

---

## My Account

`MY ACCOUNT UI: PASS` (2026-08-22).

| Field / action | Current truth |
| -------------- | ------------- |
| Identity | Supabase `user.email`; signed-in InteliAds user even during admin view-as |
| Plan | `user_metadata.plan` → `app_metadata.plan` → `user_metadata.subscription`; **METADATA ONLY** |
| Missing plan | **Unavailable** — never defaults to Pro |
| Subscription status | No iOS source; **Unavailable** — never defaults to Active |
| Amazon profile summary | Current data-view count; explicitly customer-scoped during view-as |
| Guest | Preview demo; no email/plan/status/profile ownership claims |
| Sign out | Confirm → guest/view-as/Nest invalidation/query cleanup → Supabase → auth |

No display name, trial, renewal date, raw UUID, profile editing, account deletion, or authoritative billing query exists on iOS. Do not invent them.

---

## Negatives

`NEGATIVES UI: PASS` (2026-08-22).

| Surface truth | Current behavior |
| ------------- | ---------------- |
| Entity types | `negative_keywords` + `negative_product_targets` |
| Levels | Campaign level when `ad_group_id` is absent; otherwise Ad group level |
| Keyword match | Negative exact / Negative phrase; unknown values stay Negative keyword |
| Product type | Negative ASIN or human category/brand/product-target label |
| State | Enabled / Paused / Archived / Deleted only when present; no inferred Active |
| Context | Best-effort campaign/ad-group names; no raw IDs when names are missing |
| Search | Identity, type, scope, known state, campaign, and ad group |
| Order / cap | Newest-created first; latest 500 per type; no pagination |
| Date | None — current-state entity browse, not reporting-period data |
| Actions | **READ-ONLY**; no chevrons or fake creation CTA |
| Admin view-as | Explicitly unavailable because iOS has no customer-scoped Nest negatives read |

Search Terms can create negative exact/phrase records; Rules can add negative keywords. The tables expose no trustworthy origin field, so Negatives does not claim manual vs Search Terms vs Rule creation.

---

## Data coverage

`DATA MAP UI: PASS` (2026-08-23).

| Surface truth | Current behavior |
| ------------- | ---------------- |
| Primary job | Data coverage / setup diagnostic |
| Secondary job | Selected-period Amazon Ads and imported KDP availability |
| Not its job | Profit dashboard, health score, Sync trigger, account editor, KDP collector |
| Profile scope | `selectedProfileIds`; screen says selected profiles and lists names without raw IDs |
| Date scope | Ads activity + KDP royalties use `dateRange`; setup/entity counts are current |
| Amazon Ads | Spend, **Ad-attributed sales**, **Ad-attributed orders**, activity days, last completed Ads sync |
| KDP | Linked accounts, imported royalties, KDP orders, royalty-data date; no import-freshness claim |
| Missing vs zero | Successful empty Ads period may show verified zero; missing Ads setup and missing/empty/error KDP remain `—` / explicit state. Optional 0 inventory counts say **None**, not Missing |
| Net / profit | Not displayed. No royalties-minus-spend P&L claim |
| Partial failures | Core reads and count checks settle independently; KDP failure does not erase Ads |
| Admin view-as | Explicitly unavailable because direct Supabase/KDP coverage is not safely customer-scoped |
| Actions | Navigation only: `/more/sync` and `/more/accounts`; refresh is read-only |
| Cache isolation | Key includes signed-in user, self/customer scope, profile IDs, dates; no previous-data placeholder |

Current setup inventory: selected profiles, campaigns, linked KDP accounts, ad groups, keywords, advertised products, product targets, search terms, negative keywords, and negative product targets. Optional zero counts are **None**; required-source zeros stay **Missing**. Selected-period inventory: Amazon Ads activity days, placement activity, KDP royalty days — a checked empty period is **None in period**.

Known source gaps: no authoritative KDP **import** timestamp; no customer-scoped aggregate; no direct KDP book-link/unique-book count. These are not filled with invented UI.

---

## Billing / subscription

- **Web-only by design** (parity docs + no StoreKit / Stripe / IAP in `frontend/`)
- My Account opens `https://dashboard.inteliads.io/billing` with explicit browser copy
- A user without a web session sees the web sign-in page before billing
- `/pricing-plans/current` and `/limits/status` exist in the product map but are **not wired to iOS**
- `PLAN_MANAGE_MESSAGE` remains the 402-style Nest error copy

Do not mark billing parity complete and do not implement billing during screen QA.

---

## Destructive-action inventory (remaining + related)

| Action | Confirm | Destructive style | Backend | Failure |
| ------ | ------- | ----------------- | ------- | ------- |
| Sign out | Yes | `IOSButton` role destructive | Nest + Supabase | Local fallback clears visible state if remote revoke fails; live confirmation canceled |
| Delete account | — | — | **NOT PRESENT** | — |
| Disconnect Amazon Ads | — | — | **NOT PRESENT** | — |
| Toggle profile off | **No** | Switch | `PATCH .../toggle` + local IDs | `alertMutationError` |
| KDP unlink | Yes | Red Unlink text | DELETE link | Alert |
| KDP link selected | Yes | Default | POST replaces set | Alert |
| Sync now / cancel | No | Primary / secondary | Nest | Alert |
| BidBot apply / apply placements | **No** | Primary | Nest Amazon write | Alert |
| BidBot revert | Yes | Destructive | Nest | Alert |
| BidBot save auto Aggressive | No | Save | Nest | Alert |
| Delete rule | Yes | Destructive | Nest | Alert |
| Enable rule | Yes | Default | Nest | Alert |
| Disable rule | No | Switch | Nest | Alert |
| Pause campaign/keyword/target | Yes | Destructive | Nest | Alert |
| Bid/budget save | Prompt copy says writes Amazon | Native prompt | Nest | Alert |
| Clear credentials / reset data | — | — | **NOT PRESENT** (sign-out clears admin filter + guest) | — |

---

## Shared-component gaps

| Component | Coverage | Separate workstream? |
| --------- | -------- | -------------------- |
| MetricStrip / ListCard / FilterChrome | Shared regression + list QA | No |
| TopBar / profile sheet / DateRangeControl | Used in PASSed lists; sheet itself Partial | Fold into Accounts + list leftovers |
| SubScreen | Used by every More child | Fold into those screens |
| IOSSettingsRow / grouped lists | More + Settings + Account | Fold into More / Settings |
| BidBudgetEditor | Used on PASSed mutation screens | No extra stream |
| Alert confirms | Mixed; BidBot apply missing | BidBot safety audit |
| Toast | `alertMutationError` only | No |
| IOSSearchBar | Lists already walked | No |
| DynamicIsland | Dead | No |

---

## Device QA gaps (remaining ACTIVE screens)

No dedicated small / standard / dark / Dynamic Type / VoiceOver evidence for:

Profile sheet (dedicated) · Date sheet (dedicated)

Auth / Welcome, My Account, Negatives, Data coverage, and Rule activity now have dedicated shots (`auth-*.png`, `my-account-*.png`, `negatives-*.png`, `data-map-*.png`, `rule-activity-*.png`). Boot spinner is labeled Checking session; splash canvas stays white (P2).

Completed-but-gapped (P2 / QA-env only after 2026-08-23 closure):

| Screen | Missing |
| ------ | ------- |
| Ad Groups list | Real Nest catalog (D5). Dark/XXXL used a labeled runtime fixture |
| Overview / Books 16e·Max | Populated Nest session (D17/D40). Targets 16e populated |
| Search Term Detail | Real term (D12). Fixture VO closed |
| Execution Detail | Populated entities (D32; do not run a Rule) |
| ASIN Target Detail | Dark / dedicated VO not recaptured; auto Substitutes closed |
| Profile / Date / Bid editor | Dedicated shots remain Partial |

---

## Tab coverage

| Tab | QA | Small | Dark | Dynamic Type | A11y |
| --- | -- | ----- | ---- | ------------ | ---- |
| Overview | PASS | Empty gate (D40) | PASS | PASS | PARTIAL VO speech |
| Campaigns | PASS | PASS | PASS | PASS | PASS labels / PARTIAL speech |
| Targets | PASS | PASS (populated) | PASS | PASS | PASS spoken row |
| Books | PASS | Chrome / empty | PASS | PASS | PASS |
| More | PASS | Prior More Root pass | PASS | PASS | PASS labels / speech not required |

---

## Tests / TypeScript (last known)

Notification infrastructure (2026-08-23):

- `npx tsc --noEmit`: **PASS**
- `notification-infra` + Settings + Auth + Account + More + Sync + Accounts UI + Accounts safety: **50 pass** (47 focused + 3 safety)
- `frontend/tests/data-mapping.test.js`: pre-existing stale tests 6 and 13 remain. Do not rewrite to go green.

---

## Unrelated dirty tree (not touched)

Do not clean / reset / stash / commit.

Includes: `.env`, large `.metro-cache` churn, many `frontend/` files from prior workstreams, `docs/ui-audit/*` from those streams, `.agents/skills`, `claude-code-apple-skills-main`, landing copy, assets.

BidBot contract pass also touched `frontend/app/more/bid-bot.tsx`, `frontend/src/lib/bidBotContract.ts`, `mutations.ts`, and `frontend/tests/bidbot-safety.test.js`. Do not treat those as unrelated dirty files.

---

## Recommended immediate next workstream

`TESTFLIGHT DEVICE SMOKE` after App Store Connect finishes processing 1.0.0 (3). Checklist: `IOS_TESTFLIGHT_SMOKE_CHECKLIST.md`.

Do **not** start App Store review, merge to main, or implement remote APNs from this file. Do **not** commit `.env`. UI/UX stays frozen. `INTELIADS IOS TESTFLIGHT BUILD: UPLOADED`.
