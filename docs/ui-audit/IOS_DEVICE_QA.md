# InteliAds iOS — Native Device QA

Date: 2026-08-22  
Runtime: existing native development build (`io.inteliads.app`) + Metro `--dev-client` on port 8081  
Not Expo Go (not installed on the Simulator). Did not run `expo prebuild`.

Screenshots (local audit only, do not need to be committed): `docs/ui-audit/device-screenshots/`

---

## Devices used

| Class | Simulator | UDID | Logical size | OS |
| ----- | --------- | ---- | ------------ | -- |
| Standard | iPhone 17 | `4452EAC6-52D2-44BE-B9A3-3A674F26A2BF` | 402 × 874 | iOS 26.5 |
| Small (closest available) | iPhone 16e | `962ACE26-2CDA-47EF-AD0B-2EEA877B63B0` | ~390 × 844 | iOS 26.3 |
| Large | iPhone 17 Pro Max | `5784319B-65CE-434A-8C73-026892797A0B` | ~440 × 956 | iOS 26.5 |

No SE / 375pt simulator is installed. iPhone 16e is the closest 375-class device.

**Blocker-clear continuation (same day):** launched InteliAds without a URL, waited until ready, then navigated in-app or used `simctl openurl` only while already running. Restored admin filter + Nest tokens as a QA-environment operation (see storage log). The `Open in "InteliAds"?` dialog is a Simulator custom-scheme confirmation, not a product P0.

---

## Matrix

| Screen | Small Light | Standard Light | Large Light | Dark | Large Type | VoiceOver | Touch | Result |
| ------ | ----------- | -------------- | ----------- | ---- | ---------- | --------- | ----- | ------ |
| Targets List | PASS (populated) | PASS | PASS (populated) | PASS | PASS | PASS (row + Bid captions) | PASS | PASS |
| Keyword Detail | NOT TESTED | PASS | NOT TESTED | PASS | NOT TESTED | PASS (live tree) | PASS | PASS |
| Product / ASIN Target Detail | NOT TESTED | PASS | NOT TESTED | NOT TESTED | NOT TESTED | PARTIAL | PASS | PARTIAL |
| Auto / Category Target Detail | NOT TESTED | PASS (auto “Substitutes”) | NOT TESTED | PASS (Substitutes) | NOT TESTED | PASS (live tree) | PASS | PASS |
| Search Term Detail | NOT TESTED | PASS (safe fixture) | NOT TESTED | PASS | NOT TESTED | PASS (live tree; fixture) | PASS | PASS |
| Campaigns List | PASS (populated) | PASS | PASS (populated) | PASS | PASS | PARTIAL | PASS | PARTIAL |
| Campaign Detail | PASS (Joy of Second Half) | PASS | PASS (Joy of Second Half) | PASS | PASS | PASS (identity + budget/switch live tree) | PASS | PASS |
| Ad Groups List | PASS (empty Active) | PASS (empty Active) | PASS (empty Active) | PASS (fixture) | PASS (XXXL fixture) | PASS (row labels; fixture) | PASS | PASS |
| Ad Group Detail | PASS | PASS | PASS | PASS | PASS | PASS (identity + children live tree) | PASS | PASS |
| Books List | PASS (chrome + empty range) | PASS (populated) | PASS (chrome + empty range) | PASS | PASS (XXXL + AXL) | PASS (labels on live tree) | PASS (row opens detail) | PASS |
| Book Detail | PASS (params identity + empty campaigns) | PASS (populated economics + 4 campaigns) | NOT TESTED | PASS | PASS (XXXL) | PASS (header + campaign labels) | PASS (row → Campaign, back title Book) | PASS |
| Search Terms List | PASS (new chrome + period empty) | PASS (chrome + distinct empties + sort sheet) | NOT TESTED | PASS | PASS (XXXL) | PASS (sort/search labels on live tree) | PASS (sort 44pt; actions 44pt in code) | PASS |
| Rules List | PASS (empty chrome; New rule visible) | PASS (empty chrome + create nav) | NOT TESTED | PASS | PASS (XXXL; empty title 11→16pt) | PASS (labels in code; empty catalog) | PASS (header + 44pt; New rule ~50pt) | PASS |
| More Root | PASS (Automation + Sync + Amazon accounts in first viewport) | PASS (compact InteliAds banner + grouped rows) | NOT TESTED | PASS | PASS (AXL; rows wrap, still navigable) | PASS (combined labels on live tree; VO not spoken) | PASS (full row ≥44pt; no switches) | PASS |
| Amazon Accounts | PASS (empty + Connect + KDP error) | PASS (view-as populated; Enabled vs in view) | NOT TESTED | PASS | PASS (AXL; identity stacks; first row below fold) | PASS (row/switch labels on live tree) | PASS (row + Unlink 44pt; view-as switches disabled) | PASS |
| Welcome | PASS | PASS | NOT TESTED | NOT TESTED | NOT TESTED | PASS (labels in code) | PASS | PASS |
| Login | PASS | PASS | NOT TESTED | PASS | PASS (XXXL after relaunch) | PASS (labels on live tree) | PASS | PASS |
| Signup | PASS | PASS | NOT TESTED | PASS | PASS | PASS (labels in code) | PASS | PASS |
| Forgot | NOT TESTED | PASS | NOT TESTED | NOT TESTED | NOT TESTED | PASS (labels in code) | PASS | PASS |
| Reset (web-copy) | NOT TESTED | PASS | NOT TESTED | NOT TESTED | NOT TESTED | PASS (labels in code) | PASS | PASS |
| My Account | PASS (signed-in) | PASS (view-as) | NOT TESTED | PASS | PASS (XXXL + bottom) | PASS (labels on live tree; VO not spoken) | PASS | PASS |
| Negatives | PASS (populated fixture) | PASS (keyword + product fixture) | NOT TESTED | PASS | PASS (XXXL) | PASS (combined read-only labels; VO not spoken) | PASS | PASS |

PASS = rendered and inspected on that check.  
PARTIAL = rendered, with a documented gap (see evidence).  
NOT TESTED = not actually shown on that device/appearance.

VoiceOver column: Campaigns / date control spoken on caption panel (2026-08-22). 2026-08-23: Targets combined row and Bid control spoken on the caption panel. Mutation-sensitive details confirmed on the live tree while VoiceOverTouch can run.

---

## Evidence log

### Targets List
Device: iPhone 17 · Appearance: Light · Text: Default (Large)  
Screenshot: `docs/ui-audit/device-screenshots/targets-standard-light.png`  
Result: PASS after MetricStrip fix. `91.8%` and `160.6%` fully visible in 4-up.

Device: iPhone 16e · Light · Default  
Screenshot: `targets-small-light.png`  
Result: PASS. Populated (`retirement gifts for men` phrase/exact). ACoS `91.8%` / `162.7%` not clipped. Tab bar usable.

Device: iPhone 17 Pro Max · Light · Default  
Screenshot: `targets-large-light.png`  
Result: PASS. Same entities. Layout not sparse; MetricStrip balanced.

Device: iPhone 17 · Dark · Default · `targets-standard-dark.png` · PASS  
Device: iPhone 17 · Light · extra-extra-extra-large / AXL · `targets-standard-largetype.png`, `targets-standard-xltype.png` · PASS

Device: iPhone 17 · Light · VoiceOverTouch running · `targets-voiceover-standard.png`, `targets-voiceover-spoken.png`  
Spoken caption (row): `retirement gifts for men. Phrase keyword. High ACoS. Enabled.`  
Spoken caption (Bid): `Bid $1,50. Edit bid., Button, Opens the editor. Saving writes Am…`  
Spoken caption (filters): `Filters and sort, Button, Opens performance and sort options`  
Focus: row grouping does not swallow the pause switch or Bid tap.  
Result: PASS

Device: iPhone 16e · Light · populated (safe session) · `targets-small-populated.png` · PASS. First rows visible; ACoS/spend not clipped; switches and Bid reachable; tab bar clear.

### Keyword Detail
Device: iPhone 17 · Light · Default  
Screenshot: `keyword-detail-standard-light.png`  
Also opened in-app from Targets: `keyword-detail-from-list.png` (`retirement gifts for men` exact).  
Result: PASS. Identity + switch + bid Edit + metrics. Back title `(tabs)` is P2 (also happens on in-app push, not only deep link).

Device: iPhone 17 · Dark · Default · `keyword-detail-standard-dark.png` · PASS

Device: iPhone 17 · Light · `keyword-detail-voiceover.png`  
Live tree: header `retirement gifts for men. Phrase keyword. High ACoS. Enabled`; `Current bid $1,50. Edit bid.` + Amazon-write hint; `keyword is active` switch independent of ParentLinks. Bid editor was not saved.

### Product / ASIN Target Detail
Device: iPhone 17 · Light · Default · `target-asin-standard-light.png` · PASS

### Auto Target Detail
Device: iPhone 17 · Light · Default · `target-auto-standard-light.png` · PASS

Device: iPhone 17 · Dark · `target-detail-standard-dark.png` · PASS. Substitutes / Profitable / Auto · Substitutes / Current bid $0,45 / Edit. Cards and text remain readable; no palette rewrite.

Live tree: header `Substitutes. Auto · Substitutes. Profitable. Enabled`; `target is active`; `Current bid $0,45. Edit bid.` + Amazon-write hint.

### Search Term Detail
Device: iPhone 17 · Light + Dark · Default  
Screenshots: `search-term-detail-standard-light.png`, `search-term-detail-standard-dark.png`  
No real search term was reachable (More → Search Terms empty; Ad group 1 Terms tab = 0). Opened safe fixture `inteliads://search-term/placeholder` **while the app was already running**.  
Result: PASS for this checkpoint. Identity “Search term” / “No spend yet”. **Add as keyword** + **Negate** remain available. Section error “Search term metrics failed to load” / “You can still add or negate this term.” + Retry. Child failure did not destroy the screen. Back title: **Ad group 1**. Dark Mode verified.

2026-08-23 VoiceOver: runtime fixture `qa-st-1` / `retirement journal paperback` (`search-term-detail-voiceover.png`). Live labels: header `retirement journal paperback. Spending without sales. BROAD · KEYWORD`; `Negate retirement journal paperback` + `Adds a negative on Amazon Ads`; `Add retirement journal paperback as a keyword` + `Writes a keyword on Amazon Ads`. Add/Negate were not executed. Fixture is render-only.

### Campaigns List
Device: iPhone 17 · Light · Default  
Screenshot: `campaigns-standard-light.png`  
Result: PASS. 4-up MetricStrip. Long names truncate. Second card: red ToneDot + green “Profitable” (P2 D2).

Device: iPhone 16e · Light · Default · `campaigns-small-light.png`  
Result: PASS. Populated (Joy of Second Half / Welcome to Retirement / Nostalgic Word Games). First viewport, MetricStrip, filters, state controls, tab bar OK. No horizontal clipping.

Device: iPhone 17 Pro Max · Light · Default · `campaigns-large-light.png`  
Result: PASS. Same entities. Not excessively sparse. Cards do not stretch awkwardly.

Device: iPhone 17 · Dark / XXXL · `campaigns-standard-dark.png`, `campaigns-standard-largetype.png` · PASS

### Campaigns sort chip
Device: iPhone 17 · Light · Default  
Screenshots: `campaigns-sort-sheet-standard-light.png`, `campaigns-sort-chip-active.png`, `campaigns-sort-chip-cleared.png`  
Method: React fiber `onPress` / `onChange` via Metro inspector (cliclick on the SwiftUI picker was unreliable).  
Sequence: Sort → `onChange("spend")` on `campaigns-sort-segments` → Done → chip **Sort: Spend** (list reordered, Doing Nothing `$254` first, 37 campaigns) → tap `campaigns-filter-chip-sort` → chip gone, default ROAS order restored.  
Measured chip: **44.0 pt** tall, 108 pt wide. Label readable. Does not collide with search/state filters. Live a11y: `Clear sort. Currently Spend`.  
Result: PASS. `applySort` does not dismiss the sheet; Done is required.

### Campaign Detail
Device: iPhone 17 · Light · Default · `campaign-detail-standard-light.png` · PASS (layout). Hero `$0` vs list spend remains P2 D4.  
Device: iPhone 16e · Light · `campaign-detail-small-light.png` · PASS. Joy of Second Half Automat, identity + budget Edit + 4+4+2 + Placements.  
Device: iPhone 17 Pro Max · Light · `campaign-detail-large-light.png` · PASS. Same campaign. Hierarchy consistent with standard.  
Device: iPhone 17 · Dark / XXXL / AXL · existing standard shots · PASS

Device: iPhone 17 · Light · `campaign-detail-voiceover.png`  
Live tree: header `Joy of Second Half Automat. No spend yet. Automatic · Up & Down. Enabled`; `campaign is active` + Amazon-write hint; `Daily budget $15,00/day. Edit budget.` + `Opens the budget editor. Saving writes Amazon Ads.` Budget editor was not saved. Hero `$0` vs list spend remains P2 D4.

### Ad Groups List
Device: iPhone 17 / 16e / Pro Max · Light  
Screenshots: `ad-groups-standard-light.png`, `ad-groups-small-light.png`  
Result: PASS empty Active (“No ad groups” / “None in this period.”). Known P2 D5 (`fetchAdGroups` has no `filterUserId`).

Device: iPhone 17 · Dark · runtime fixture · `ad-groups-standard-dark.png`  
Result: PASS. Page vs ListCard separation, titles, High ACoS / Wasting spend, ACoS/spend, switches, Active segment, search, and debugger toast (D15) remain readable. No palette rewrite.

Device: iPhone 17 · Light · extra-extra-extra-large requested · `ad-groups-standard-largetype.png`  
Result: PASS usable. Fixture rows show 4-up ACoS/Spend/Sales/Orders. Visual type size looks near default (Simulator `content_size` may not scale RN text). Not a P0/P1 wrap/clip failure.

Live tree (fixture): `Welcome to Retirement — exact keywords, Active, High ACoS, ACoS 43.8%, Spend $42,18, 7 orders` + `Opens ad group details`; `ad group is active` switch remains independent of the row button.

Fixture note: React Query `["ad-groups-list", …]` was pinned at runtime because D5 admin `fetchAdGroups` returns empty Active. Render/dark/DT only. Does **not** prove live pause/API.

### Ad Group Detail
Device: iPhone 16e · Light · `ad-group-detail-small-light.png` · PASS. Ad group 1, paused switch, 4+4+2, Keywords (22).  
Device: iPhone 17 Pro Max · Light · `ad-group-detail-large-light.png` · PASS. Not sparse; Keywords rows readable.  
Device: iPhone 17 · Light / Dark / XXXL · existing standard shots · PASS

Device: iPhone 17 · Light · `ad-group-detail-voiceover.png`  
Live tree: header `Ad group 1. No spend yet. Manual. Paused`; `ad group is paused` + Amazon-write hint; child `retirement gift ideas for men, phrase, Spending without sales, … Opens keyword details`. Nested keyword rows stay distinguishable from the parent header.

---

## Checks that were actually performed

| Check | Result |
| ----- | ------ |
| Light on iPhone 17 core path | PASS |
| Dark on Campaigns, Targets, Campaign Detail, Keyword Detail, Ad Group Detail, Search Term Detail | PASS |
| Dynamic Type XXXL + AXL on Targets, Campaigns, Campaign/Ad Group Detail | PASS |
| MetricStrip 4-up and 2×2 | PASS (after width fix) |
| Caption / `text_tertiary` contrast | FAIL WCAG 4.5:1 (~2.0:1 measured). Readable. P2 |
| VoiceOver speech | PASS. Preference alone is not enough on iOS 26 — `launchctl kickstart system/com.apple.VoiceOverTouch` is required (`VOTIsRunningKey=1`, pid running). Caption panel observed. Spoken 2026-08-22: Campaigns tab / date range. Spoken 2026-08-23: Targets row `retirement gifts for men. Phrase keyword. High ACoS. Enabled.` and Bid `Bid $1,50. Edit bid.` Filters `Filters and sort`. Mutation-sensitive details confirmed on the live tree (keyword / target / campaign / ad group / search-term). Switch stays independent of row navigation. |
| Touch: Campaigns sort sheet + chip | PASS (Spend selected, chip 44pt, clear works) |
| Keyboard / search | PASS with limitations. Typed `retire` → 6 campaigns; cleared → full list, no permanent offset. Software keyboard not shown on search (Simulator hardware-keyboard path). Budget editor showed numeric pad; Cancel/Save above keyboard. Did **not** Save. |
| Filter / sort sheet interaction | PASS via fiber `onChange` + Done. Sheet did not stay orphaned after Done. |
| Nav chain via in-app navigation | PASS (fiber `onPress` / `navigation.goBack`, not cold `openurl`) |
| List scroll restore | PASS. Campaigns: scrolled to Doing Nothing `$254` / Grandma / Walking → opened Doing Nothing → back → same position. Targets: scrolled to `retirement gift ideas for men` / `couple questions` → opened keyword → back → same mid-list (not top `$249`). |
| Reduce Motion | PASS. Enabled `ReduceMotionEnabled=1` on iPhone 17. Campaigns Active filter + Campaign Detail (Grandma Automat) rendered. No list entrance stagger. Layout remained understandable. Press still opened detail. Existing code already skips `LayoutAnimation` and card press scale. |
| Pull-to-refresh | NOT TESTED |
| Performance feel (iPhone 17) | PASS observational — no jank noted on lists |

---

## VoiceOver (engine running + caption panel + live tree)

Cause of earlier miss: `VoiceOverTouchEnabled=1` without starting `com.apple.VoiceOverTouch`. iOS 26 Simulator Features has no Toggle VoiceOver item.

Evidence: `voiceover-gestures-dialog.png`, `voiceover-campaigns-spoken.png`, `voiceover-date-range-caption.png`.

Still live tree (VO uses these labels):

| Control | Observed on device tree |
| ------- | ----------------------- |
| Campaign row | `Joy of Second Half Automat, Active, Profitable, ACoS 11.2%, Spend $3,13, 2 orders` role `button` |
| Target / keyword row | No combined `accessibilityLabel`. Visible children: name, verdict, match type, MetricStrip, switch `keyword is active`, Bid. Not treated as P0/P1 this pass. |
| Ad group row | Not spoken. Ad Groups default Active is empty (D5). |
| Campaigns sort button | `Sort campaigns` (default) / `Sort: Spend` when active; hint `Opens sort options` |
| Campaigns sort chip | `Clear sort. Currently Spend` |
| Bid / budget | `Daily budget $15,00. Edit budget.` Targeting Bid control label `Bid` |
| State switch | `campaign is active` (`checked: true`); `keyword is active` (`checked: true`) |

### Books List
Device: iPhone 17 · Light · Default · `books-standard-light.png`  
Result: PASS. Cover 52×70 + wrapping title; ASIN off the list row; Profit hero; MetricStrip Royalties / Spend / Orders / ACoS. First card top ≈ 259pt. Search + 4-segment sort only (no extra filter rows).

Device: iPhone 17 · Dark · Default · `books-standard-dark.png`  
Also Spend-sorted Dark: `books-standard-dark-spend.png`  
Result: PASS. Cover separation, card vs page, status tones, `$0.00` vs `—`.

Device: iPhone 17 · Light · extra-extra-extra-large · `books-standard-largetype.png`  
Result: PASS. Title wraps; MetricStrip 4 → 2×2; ACoS `206.2%` / `449.4%` visible; two cards in viewport.

Device: iPhone 17 · Light · accessibility-extra-large · `books-standard-xltype.png`  
Result: PASS (reflow). Metrics stack; one card in viewport; values not clipped inside the card. Stale strip width after returning to Large was a shared MetricStrip defect (reset on fontScale); Campaigns 4-up re-checked.

Device: iPhone 17 · Light · Spend sort · `books-standard-sort-spend.png`  
Result: PASS. Non-default sort visible. Royalties `$29.05` vs Spend `$98.80` vs Profit `$-69.75` on one row. ACoS `206.2%` not clipped.

Device: iPhone 17 · search `zzznomatch` · `books-standard-search-empty.png`  
Result: PASS. `0 books` + “No matching books” / “Try a different title or ASIN.”

Device: iPhone 17 · row press · `books-nav-detail.png`  
Result: PASS. Opens stack **Book Campaigns** (not redesigned). Live a11y: title, verdict, royalties, ad spend, ACoS, orders, profit; hint “Opens book details”.

Device: iPhone 16e · Light · `books-small-light.png`  
Result: PASS chrome. Search + Profit/Spend/ACoS/Orders + empty “No book data in range”. Admin catalog session did not transfer (SecureStore Nest tokens). Populated row density verified on iPhone 17 (402pt).

Device: iPhone 17 Pro Max · Light · `books-large-light.png`  
Result: PASS chrome. Same empty-range session. Controls stay dense, not oversized empty cards.

---

`BOOKS LIST: PASS`

### Book Detail
Device: iPhone 17 · Light · Default · `book-detail-standard-light.png`  
Also empty-campaigns: `book-detail-standard-light-empty-campaigns.png` (Finnland, royalties + $0 spend, distinct empty campaigns).  
Result: PASS. First card top ≈ 182pt. Identity 52×70 + title wrapping up to 3 lines + verdict + ASIN + Profit. MetricStrip Royalties / Spend / Orders / ACoS. Traffic caption. Campaigns use list language (verdict + ACoS/Spend/Sales/Orders).

Device: iPhone 17 · Dark · Default · `book-detail-standard-dark.png` · PASS

Device: iPhone 17 · Light · extra-extra-extra-large · `book-detail-standard-largetype.png` · PASS. Title wraps to 3 lines then ellipsis; 4-up metrics remain readable; first campaign still in view.

Device: iPhone 17 · campaign push · `book-detail-to-campaign.png`  
Result: PASS. Stack title Campaign; back title **Book**. Date range unchanged. Campaign Detail $0 vs list rollup is existing D4 (data), not this screen.

Device: iPhone 16e · Light · `book-detail-small-light.png`  
Result: PASS chrome. Params identity + ads fallback strip + “No campaigns in this period”. No admin book-row cache on this device (same D17).

Live a11y header: title, verdict, royalties, ad spend, ACoS, profit. Campaign row: name, verdict, ACoS, spend, orders. Hint “Opens campaign details”. Cover not in the label.

---

`BOOK DETAIL: PASS`

### Search Terms List
Device: iPhone 17 · Light · Default · `search-terms-standard-light.png`  
Result: PASS chrome. Search + 44pt sort button + All/Converting/No orders. First content ~230pt (was ~340pt with two sort/filter rows + summary card). Empty: “No search terms in this period” / “None for the selected dates.”

Also: `search-terms-standard-search-empty.png` (“No matching search terms”), `search-terms-standard-filter-empty.png` (“No converting terms”), `search-terms-standard-sort-sheet.png` (Orders default).

Device: iPhone 17 · Dark · Default · `search-terms-standard-dark.png` · PASS

Device: iPhone 17 · Light · extra-extra-extra-large · `search-terms-standard-largetype.png` · PASS. Search, sort, segments reflow. Font scaling not disabled.

Device: iPhone 16e · Light · `search-terms-small-light.png`  
Result: PASS chrome. Same period empty. No horizontal clip. Tab/debug toast is D15.

Device: iPhone 17 · placeholder detail · `search-terms-to-detail.png`  
Result: existing Search Term Detail unchanged (Add/Negate + section Retry). Not redesigned. No populated list row existed to tap (DATA).

Live a11y: date control `Date range: Aug 1-22, 2026`; sort `Sort search terms`. Row combined label is in code; no populated term in this session to speak.

DATA: `fetchSearchTerms` has no Nest `filterUserId`. Admin catalog session returns `[]` — same class as Ad Groups D5. Do not change `queries.ts`.

---

`SEARCH TERMS LIST: PASS`

### Rules List
Device: iPhone 17 · Light · Default · `rules-standard-light.png`  
Result: PASS chrome. Distinct empty: “No rules yet” / “Create a rule… New rules start disabled.” + **New rule**. Recent runs stay secondary (“No runs yet”). Summary card and duplicate CTA removed so the first rule/action is in the first viewport.

Also: `rules-to-create.png` (existing `/more/rule-create`, not redesigned), `rules-nav-back.png` (back to Rules).

Device: iPhone 17 · Dark · Default · `rules-standard-dark.png` · PASS. Black page + `#1C1C1E` run card. Enabled/Disabled and New rule remain readable. No hardcoded light surfaces.

Device: iPhone 17 · Light · extra-extra-extra-large · `rules-standard-largetype.png` · PASS. Empty title band grew ~11→16pt logic. Fonts not shrunk. Header title stays system 17/600 (known bar limit).

Device: iPhone 16e · Light · `rules-small-light.png`  
Result: PASS chrome. New rule + Recent runs both visible. No horizontal clip. Tab/debug toast is D15.

Live a11y: header `New rule` + hint “Creates a rule. New rules start disabled.” Row combined label (name, Enabled/Disabled, scope, When, Then, last run) + “Opens the rule editor.” Switch is a separate control. No populated rule in this session to speak.

DATA: `fetchOptimizationRules` queries `user_id = logged-in user` (no Nest `filterUserId`). Admin catalog session returns `[]` — same class as Search Terms D23 / Ad Groups D5. Do not change `queries.ts`. Do not create a production Rule for screenshots.

---

`RULES LIST: PASS`

### Rule Builder (Create + Edit)
Route: `/more/rule-create`. Did **not** create or enable a production Rule. Edit used a local fixture in route params only. Did **not** open Execution Detail.

Device: iPhone 17 · Light · Default · `rule-builder-create-standard-light.png` / `rule-builder-condition-standard-light.png`  
Result: PASS. Hierarchy WHAT → WHEN (AND) with ACoS **30 %** + “When ACoS > 30% (14d)”. Scope chips use human labels. Caption: “Applies to Sponsored ads - Author - US. Matches every keyword in that account, not one selected keyword.”

Also: `rule-builder-action-standard-light.png` + `rule-builder-cta-standard-light.png`  
THEN Pause shows “This action does not use an amount.” Frequency: Daily / Every 6h / Every 12h / 2 days / Weekly, hint “Not a cooldown”. Review uses the same When/Then formatter as the list. Warning: “New rules start **off**.” CTA: **Create rule (off)**.

Device: iPhone 17 · Dark · Default · `rule-builder-standard-dark.png` · PASS. Name field, chips, condition card, and `%` use `background_secondary` / `tertiary`. No light-only inputs.

Device: iPhone 17 · Light · extra-extra-extra-large · `rule-builder-standard-largetype.png` · PASS. Section labels and chips reflow. Fonts not shrunk. Header stays system 17/600 (known bar limit).

Device: iPhone 16e · Light · `rule-builder-small-light.png`  
Result: PASS chrome. Same sections; no horizontal clip. Caption uses “1 selected account” when the nickname list is empty on that device. Tab/debug toast is D15.

Keyboard: `rule-builder-keyboard-name.png` · PASS. Name field focuses; software keyboard after disconnecting Simulator hardware keyboard. Focused field stays visible. `KeyboardAvoidingView` + `keyboardShouldPersistTaps="handled"`. CTA lives in the scroll view.

Edit fixture (disabled; **Save / Delete not tapped**): `rule-builder-edit-fixture.png` + `rule-builder-edit-action.png`  
Name “Reduce bids when ACoS exceeds break-even”; scope locked Keywords; ACoS > 35% (14d); Decrease bid by **10 %** / “% percent”; Review “Then Decrease bid by 10%”; “This rule is off. Saving updates the configuration and leaves it off.” CTA **Save changes**.

Missing payload: `rule-builder-edit-missing.png` · PASS. “Couldn't open this rule” + Back — not a blank create form.

---

`RULE BUILDER: PASS`

### Rule Builder safety (do not weaken)

- New rules are created with Nest `enabled: false`. The CTA is **Create rule (off)**.
- Enable remains on the Rules list with confirm. The builder does not enable.
- Edit `updateOptimizationRule` does not send `enabled` or target entity.
- Pause / harvest omit leftover numeric `value`. Changing action clears `actionValue`.
- QA must not tap Save/Create on a live account, and must not enable a new Rule.

### Rule Execution Detail
Route: `/more/rule-detail/[id]` — `[id]` is an **execution ID**. Did **not** create, enable, or run a Rule.

Device: iPhone 17 · Light · Default · `rule-execution-standard-light.png`  
Result: PASS chrome. First viewport is Rule name + **Completed** text + “No changes needed.” + absolute time `22 Aug 2026 at 14:32 · 2h ago` + Changed 0 / Failed 0. Evaluated gap is labeled. Revert/Reapply stay below the record with “write to Amazon” copy. Existing Amazon actions were not tapped.

Also: `rule-execution-failed-light.png` — **Failed** + “This run failed.” is distinct from no-change. Empty: “No entity records” / “This run failed. Individual entity rows were not stored.”

Device: iPhone 17 · Dark · Default · `rule-execution-standard-dark.png` · PASS. Dark summary card and pills. No light-only surfaces.

Device: iPhone 17 · Light · extra-extra-extra-large · `rule-execution-standard-largetype.png` · PASS. Name and status wrap. Header title truncates (system bar). Fonts not shrunk.

Device: iPhone 16e · Light · `rule-execution-small-light.png`  
Result: PASS chrome. Same hierarchy in the first viewport. No horizontal clip. D15 toast.

`DEVICE POPULATED STATE: BLOCKED BY SAFE DATA AVAILABILITY` — Rules shows “No runs yet”. Entity before/after rows were not rendered from live history. Formatters cover currency / % / state in tests.

---

`RULE EXECUTION DETAIL: PASS`

---

### Overview / Dashboard UI (2026-08-22)

Route: `/(tabs)/index` · tab title Overview. Data contract: `IOS_DASHBOARD_DATA_AUDIT.md`.

Device: iPhone 17 · Light · Default · `dashboard-standard-light.png`  
Result: PASS. First viewport is account + period, then **Royalties − spend** (honest label), missing net as `—`, “Royalties unavailable for this period.”, 2×2 Royalties / Ad spend / ACoS / Margin (`$0.00` spend vs `—` royalties). Compact Top books empty + Books CTA. **Spending without orders** lists real keywords (`retirement gifts for men` $26.76, `Loose Match` $9.32). No giant empty hero. No decorative illustration.

Device: iPhone 17 · Dark · Default · `dashboard-standard-dark.png` · PASS. Grouped dark cards. No hardcoded light surfaces. Spend stays `$0.00`; missing stays `—`.

Device: iPhone 17 · Light · extra-extra-extra-large · `dashboard-standard-largetype.png` · PASS. Headline uses `metric_massive` (scales). Financial values do not clip.

Device: iPhone 17 · Light · accessibility-extra-large · `dashboard-standard-xltype.png` · PASS after overflow + 2×2 strip. Helper copy shortened so AXL does not clip mid-word.

Device: iPhone 16e · Light · `dashboard-small-light.png`  
Result: PASS empty gate. No Nest session (D17). “No Amazon account” / Connect account. No metric cards. No horizontal clip.

Device: iPhone 17 Pro Max · Light · `dashboard-large-light.png`  
Result: PASS chrome. Cards stay compact; they do not inflate into empty heroes.

Historical pre-refinement shots remain: `overview-current-*.png`.

Navigation: in-card Books → `/(tabs)/products`; book row → `/product/[asin]`; bleeders → `/keyword/[id]`. Simulator tab-bar taps this pass hit the Expo debugger toast (D15) over the tab bar. Native tabs themselves already PASS in core device QA.

---

`DASHBOARD / OVERVIEW UI: PASS`

---

### More Root
Device: iPhone 17 · Appearance: Light · Text: Default (Large)  
Screenshot: `docs/ui-audit/device-screenshots/more-standard-light.png`  
Scrolled App section: `more-standard-light-scrolled.png`  
Result: PASS. Compact InteliAds banner (`test@gmail.com` / InteliAds account — not Amazon profile count). AUTOMATION then DATA then APP. Bid bot is the first navigation row (~219pt). No Sync Now / Apply / Enable Auto / Unlink on the hub.

Device: iPhone 16e · Light · Default · `more-small-light.png` · PASS. Automation (6) + Sync + Amazon accounts in the first viewport. No clip. Tab bar usable. Debugger toast is D15.

Device: iPhone 17 · Dark · Default · `more-standard-dark.png` · PASS. Grouped dark cards, semantic tokens, subtitle contrast uses `text_secondary` (sampled ~3.4:1 on white — shared theme, not a More-only rewrite).

Device: iPhone 17 · Light · accessibility-extra-extra-large · `more-standard-largetype.png` · PASS. Banner + rows wrap. Fewer rows in the first viewport; screen stays scrollable. App section still reachable (`/tmp/more-axl-bottom.png`).

Navigation (fiber `onPress` from More, then `navigation.goBack`): Bid bot, Ad groups, Negative targeting, Search terms, Rules, Rule activity, Sync, Data map, Amazon accounts, Settings, My account, account banner. Destinations: `more-nav-*.png`. Back title is `(tabs)` (D3 P2) — not a More-only rewrite.

VoiceOver: combined labels on the live tree (`Bid bot. Recommendations and automation`). Decorative icons hidden. Speech not run.

`MORE ROOT: PASS`

---

### Amazon Accounts
Device: iPhone 17 · Light · Default · view-as customer  
Screenshot: `accounts-standard-light.png`  
KDP lock: `accounts-standard-light-kdp.png`  
Result: PASS. Compact InteliAds identity (not Amazon). Banner “Viewing a customer. Changes are off.” US profile **Enabled · In current view**; AU/CA/FR **Disabled · Not in current view**. Switches disabled. No Connect CTA while view-as. No Ads disconnect.

Device: iPhone 16e · Light · `accounts-small-light.png` · PASS empty. “No Amazon profiles” + Connect Amazon + KDP load error / Retry / Chrome helper. Not “No data.”

Device: iPhone 17 · Dark · `accounts-standard-dark.png` · PASS. Grouped dark cards; Enabled text + switch (color not the only status).

Device: iPhone 17 · AXL · `accounts-standard-largetype.png` · PASS. Banner and counts wrap on purpose. Email can split `test@gmail.co` / `m` (P2). First profile peek; scroll required. No broken row geometry.

VoiceOver: live labels include name, marketplace, Enabled/Disabled, in-view, switch hint “Does not disconnect Amazon.” Speech not run. No enable/disable/unlink executed (view-as locked).

`ACCOUNTS UI: PASS`

---

### Sync
Device: iPhone 17 · Light · Default · signed-in self, plan-gated  
Screenshot: `sync-standard-light.png`  
Result: PASS. First viewport is Amazon Ads state + timestamp/helper + Sync now. Copy is Ads-only (“Amazon Ads not synced yet”). Helper: “Showing selected profiles. Sync runs for all enabled profiles.” Plan caption under a disabled Sync now. No Completed/Failed/Records hero cards. Empty logs: “No Amazon Ads sync history” / “No sync sessions.” Not “No account connected.”

Device: iPhone 16e · Light · `sync-small-light.png` · PASS empty / Nest-unavailable. Status “Couldn't check Amazon Ads status” (not “Syncing”). Sync now + Retry + “No profiles in the current view.” No horizontal clip. Debugger toast is D15.

Device: iPhone 17 · Dark · `sync-standard-dark.png` · PASS. Grouped `background_secondary` cards; helper and plan copy use `text_tertiary`/`text_secondary`. No hardcoded light surfaces.

Device: iPhone 17 · XXXL · view-as customer · `sync-standard-largetype.png` · PASS. Banner “Viewing a customer. Sync now and Cancel stay off.” Status “Syncing Amazon Ads…” with spinner (not a percent). No Sync now / Cancel. Recent activity: “Customer sessions not loaded here.” Rows wrap. Debugger toast is D15.

VoiceOver: live labels include `Amazon Ads not synced yet` / `Syncing Amazon Ads`, `Sync now` + enabled-profile hint, refresh “Does not start a new sync,” view-as banner. Speech not run. No Sync Now / Cancel executed.

`SYNC UI: PASS`

---

### Bid bot
Device: iPhone 17 · Light · Default · view-as customer  
Screenshot: `bidbot-standard-light.png`  
Settings: `bidbot-settings-standard-light.png`  
About: `bidbot-about-standard-light.png`  
View-as lock: `bidbot-viewas-lock.png`  
Result: PASS. Compact Off / last run / Target ACoS + mode caption. Scope helper: account-wide, header filter does not limit. Recs fetch error is “Couldn't load bid recommendations” / “Retry does not apply bids.” Not “No recommendations.” Run stays visible and locked. Banner: “Viewing a customer. Apply, Run, Revert, and auto mode stay off.” Real Run tap shows “Bid Bot changes aren't available while viewing another user's accounts.” Settings: Target ACoS editable field (locked), min/max **0,50 / 1,50** display-only with the web-vs-iPhone-Settings caption. About uses contract copy (snapshot, categorical confidence, no schedule claim). No `$` / selected-profile scope.

Device: iPhone 16e · Light · `bidbot-small-light.png` · PASS empty / Nest-unavailable. Status “Couldn't load BidBot status.” Scope helper + Run + rec Retry. No horizontal clip. Debugger toast is D15.

Device: iPhone 17 · Dark · `bidbot-standard-dark.png` · `bidbot-settings-standard-dark.png` · `bidbot-about-standard-dark.png` · PASS. Grouped `background_secondary` cards; warning banner readable; Off pill + Careful/Aggressive labels not color-only.

Device: iPhone 17 · XXXL · view-as customer · `bidbot-standard-largetype.png` · `bidbot-settings-standard-largetype.png` · PASS. Banner, mode caption, currency gap, and min/max caption wrap. Cards grow. AXL (`accessibility-extra-extra-extra-large`) crowds the first viewport (D51); XXXL is the gate size used on Sync.

Confirmations (contract copy, Cancel only; no Amazon write): `bidbot-apply-confirmation.png`, `bidbot-placement-confirmation.png`, `bidbot-aggressive-confirmation.png`, `bidbot-run-auto-confirmation.png`. Background LogBox on those four is a CDP `__r` probe (D52), not a BidBot product error. View-as lock shot is a real `onRun` Alert.

VoiceOver: live labels include Off + mode meaning + last run, `Run engine. Generates recommendations only.`, view-as banner. Apply / placement / Run-auto labels exist in code. Speech not run. No Apply / Run / Revert / Aggressive save executed.

`BIDBOT UI: PASS`

---

### Settings
Device: iPhone 17 · Light · Default  
Screenshot: `settings-standard-light.png`  
Scrolled: `settings-standard-light-scrolled.png`  
Result: PASS. First viewport is Notifications (no save banner). Overspend copy uses campaign daily budgets. Test row is “Send a test on this iPhone.” Ads → Bid bot only; footer says this iPhone does not cap Amazon bids. Profit source = KDP royalties, no chevron. Appearance = Follows system, no chevron.

Device: iPhone 16e · Light · `settings-small-light.png` · PASS. Notifications + Ads in first viewport. No clip. Debugger toast is D15.

Device: iPhone 17 · Dark · `settings-standard-dark.png` · PASS. Grouped `background_secondary` cards; switches and slider readable. No hardcoded light surfaces.

Device: iPhone 17 · XXXL · view-as customer · `settings-standard-largetype.png` · PASS. Self-scope note wraps: “These preferences apply to your signed-in account, not the customer you're viewing.” Rows and footers wrap. No text shrink. AXL not required (XXXL is the gate size).

Keyboard: no text fields remain. N/A.

VoiceOver: live labels include `New orders, on`, `Overspend threshold, 25 percent above campaign daily budgets`, `Send a test on this iPhone` + local-not-push hint, `Profit source. KDP royalties` role text, `Appearance. Follows system` role text. Speech not run. Guest lock is code-verified (no guest device shot).

`SETTINGS UI: PASS`

---

### Authentication
Standard shots used a clean `iPhone 17 Auth QA` simulator (`AAF9CA44-A3A6-492A-B0D9-339D77AE6776`) so the populated iPhone 17 QA session was not signed out. Small shots: iPhone 16e after a Metro-connected reinstall. RouteGuard bounce: populated iPhone 17.

Device: iPhone 17 Auth QA + iPhone 16e · Light · Default  
Screenshots: `auth-welcome-standard-light.png`, `auth-welcome-small-light.png`, `auth-login-standard-light.png`, `auth-login-small-light.png`, `auth-signup-standard-light.png`, `auth-signup-small-light.png`, `auth-forgot-standard-light.png`, `auth-reset-standard-light.png`  
Result: PASS. Welcome uses SF Symbols + Sign in / Next / Create account. Login first viewport has brand, email, password, Sign in, Forgot, Create one, Preview demo. Signup shows the 6-character rule only. Forgot and reset say finish on the web. Reset unauthenticated state has no password fields.

Device: iPhone 17 Auth QA · Dark · `auth-login-standard-dark.png`, `auth-signup-standard-dark.png` · PASS. Grouped `background_secondary` fields; placeholders and links readable. No light-only TextInput.

Device: iPhone 17 Auth QA · XXXL after relaunch · `auth-login-standard-largetype.png`, `auth-signup-standard-largetype.png` · PASS. Ink/layout grows vs default (`auth-login-standard-light.png`). Labels, buttons, Forgot, and Create one remain readable. Scroll available if needed.

Error: `auth-login-error-standard-light.png` — form-level “Enter your email and password.” after empty submit. Password not cleared.

Guest: `auth-guest-overview-small-light.png` — Preview demo lands on Overview empty “Sign in to see your numbers.” No sample Amazon numbers.

RouteGuard: `auth-guard-bounce-standard-light.png` — authenticated iPhone 17 `replace("/auth/login")` stays on tabs/Overview.

Keyboard: `AuthScreen` uses `KeyboardAvoidingView` + `automaticallyAdjustKeyboardInsets`. Software-keyboard screenshot on this Simulator stayed flaky after I/O → Keyboard toggle (D57). Email/password types and return keys are in code.

VoiceOver: live labels include Sign in, Email, Password, Show/Hide password, Forgot password?, Preview demo + hint, Create one. Speech not run.

`AUTHENTICATION UI: PASS`

---

### My Account
Route: `/more/account` · source: `frontend/app/more/account.tsx`.

Before: `my-account-before-standard-light.png` rendered the actual old bundle: signed-in email plus a green **Pro** pill, **Status Active**, ambiguous **Active accounts 1 of 0**, default USD, and no indication that the admin was viewing customer data. That was the P1 baseline.

Device: iPhone 17 · Light · Default · signed-in admin while viewing a customer  
Screenshot: `my-account-standard-light.png`  
Result: PASS. Banner says customer Amazon data is in view while the page still shows the signed-in InteliAds account. Email remains the admin's. Plan and Subscription status are **Unavailable** (no fake Pro/Active). Billing is explicitly web. Amazon row says **profiles in current view**, `1 of 12`, and Customer data. Sign out is separated under Session with a consequence footer.

Billing handoff: `my-account-billing-web.png` · PASS. **Manage subscription on the web** opens `dashboard.inteliads.io`; the web app asks the user to sign in when no web session exists. No StoreKit/IAP or in-app Stripe UI was added.

Sign-out confirmation: `my-account-signout-confirmation.png` · PASS. Native alert names InteliAds, shows the signed-in email, says it returns to Sign in on this iPhone, and offers Cancel / destructive Sign out. **Canceled**; the populated production QA session was not signed out.

Device: iPhone 16e · Light · Default · signed-in QA session  
Screenshot: `my-account-small-light.png`  
Result: PASS. Identity, Plan/Status unavailable, web billing, Amazon profile summary, Sign out, and consequence footer fit without horizontal clipping. The QA session was copied in memory without printing credentials and then cleared with Supabase **local** scope only.

Guest: `my-account-guest-standard-light.png` · PASS. Preview demo says no InteliAds account is signed in, hides subscription/profile/sign-out claims, and offers Sign in / Create account. `my-account-guest-to-login-small.png` verifies guest → Sign in.

Device: iPhone 17 · Dark · `my-account-standard-dark.png` · PASS. Identity, warning note, grouped rows, web CTA, and destructive session action use theme surfaces.

Device: iPhone 17 · XXXL · `my-account-standard-largetype.png`, `my-account-standard-largetype-bottom.png` · PASS. View-as note, long billing label, profile label, values, and footers wrap. Scroll-to-end verifies Sign out and its consequence remain reachable.

Navigation: `my-account-back-more.png` · PASS. More → My Account → Back returns to More. Existing generic stack-back-title behavior remains D3/D43 P2.

VoiceOver: live host labels include `Plan. Unavailable`, `Subscription status. Unavailable`, `Manage subscription on the web` + browser hint, `Amazon profiles in current view. Customer data. 1 of 12`, and `Sign out` + local-session consequence. Decorative logo is grouped into the identity header. Speech not run.

Sign-out cleanup: focused tests verify guest flag, persisted/in-memory admin view-as, selected profile scope, Nest SecureStore tokens, a non-sensitive Nest-session invalidation marker, React Query memory cache, and persisted query snapshot are cleared. The marker blocks stale Nest credentials even if Keychain deletion fails. Global sign-out is retained; if it fails, Supabase local sign-out still clears app-visible state. No token or credential values were logged.

`MY ACCOUNT UI: PASS`

---

### Negatives
Route: `/more/negative-targeting` · source: `frontend/app/more/negative-targeting.tsx`.

Architecture/device truth: the screen browses current-state `negative_keywords` and `negative_product_targets`. It has no date range, navigation, creation, edit, pause, delete, or restore action. Search Terms and Rules remain the creation paths. Queries are newest-first and capped at the latest 500 per type.

Populated evidence used a local runtime-only fixture on the disposable Auth QA / 16e simulators because the original signed-in QA session was no longer restorable and direct Supabase RLS cannot read another customer. Fixtures included long Spanish text, punctuation, one-word exact, campaign/ad-group levels, enabled/paused/unknown state, an ASIN, and a category target. No source files, credentials, database rows, or Amazon state were mutated.

Device: iPhone 17 Auth QA · Light · Default  
Screenshot: `negatives-standard-light.png`  
Result: PASS. Search + one compact Keywords/Products filter, count, and first row remain in the first viewport. Rows prioritize full negative identity, then human match/scope/state, then campaign/ad-group context. All three fixture rows are visible. No red “error” treatment and no chevrons.

Product type: `negatives-products-standard-light.png` · PASS. ASIN `B012345678` is labeled Negative ASIN / Campaign level; category value uses Negative product target · Category / Ad group level. Raw expressions are never JSON-stringified.

Search: `negatives-search-context.png` · PASS. Searching `Japan` matches the campaign name, yielding one matching negative keyword. Search also covers identity, type, ad group, scope, and known state.

Admin view-as: `negatives-viewas-blocked.png` · PASS. The screen says customer negatives are unavailable and directs the admin to switch back from Campaigns, Targets, or Books. It does not show a false “No negatives” or stale self rows.

First useful row: old code/layout estimate **~180pt** before the row (segment + count only); refined device render **~248pt** after adding search. Despite the added 36pt search control, the 16e still shows all three dense rows in the first viewport.

Device: iPhone 16e · Light · Default · `negatives-small-light.png` · PASS. Long/non-English/punctuation identities wrap; no horizontal clip; three rows visible.

Device: iPhone 17 Auth QA · Dark · `negatives-standard-dark.png` · PASS. Search, native segment, card surfaces, labels, and separators follow theme tokens.

Device: iPhone 17 Auth QA · XXXL · `negatives-standard-largetype.png` · PASS. Identity and metadata grow without font shrinking; long rows expand vertically and stay readable.

Loading/error/empty: initial load uses `ScreenSpinner`; query-key changes explicitly disable previous-data carry-over; cached rows remain during refresh; no-cache failure uses `RetryState`; cached refresh failure stays inline. Search, type, no-profile, guest, customer-view, and true-empty copy are distinct.

VoiceOver: live keyword labels combine identity, Negative exact/phrase, campaign/ad-group level, available parent names, and known state. Rows use role text because they are not actionable. `IOSSearchBar` now explicitly uses its placeholder as the accessibility label. Native segmented control remains the established `@expo/ui` picker. Speech not run.

Performance: `FlatList`, stable ID, memoized primitive-prop row, stable render/key callbacks, no nested ScrollView, no entrance stagger. Parent names are best-effort batched reads. No FlashList dependency was added.

`NEGATIVES UI: PASS`

---

### Data coverage
Route: `/more/data-map` · source: `frontend/app/more/data-map.tsx` · user-facing title: **Data coverage**.

Architecture/device truth: this is a mixed diagnostic. Current setup counts are profile-scoped; Ads activity and imported KDP royalties are date-scoped. It is not a P&L, health score, Sync trigger, account editor, or KDP collector. The screen has no mutation.

Before: the first useful diagnostic rows were below a large **Net profit** hero and ACoS / generic Ad Sales cards (source estimate roughly **>430pt** from the top). Missing KDP fell through to `$0 royalties` and negative net.  
After: the scope/period explanation starts around **207pt** on iPhone 17; the first explicit Amazon Ads state starts around **343pt**. Both Amazon Ads and KDP begin in the first viewport. Source cards now also show honest period money: Ads spend / ad-attributed sales / orders, and imported KDP royalties / KDP orders. No aggregate profit or health score is shown.

Device: iPhone 17 Auth QA · Light · Default · runtime-only populated fixture  
Screenshot: `data-map-standard-light.png`  
Result: PASS. The first viewport names the two selected profiles and date scope, then shows separate Amazon Ads and imported KDP source cards. Ads uses **Amazon Ads spend**, **Ad-attributed sales**, and **Ad-attributed orders**. KDP uses **Imported KDP royalties** and **KDP orders**. The KDP card says collection happens through the Chrome helper and iPhone only reads linked data.

Missing-vs-zero: `data-map-missing-standard-light.png` · PASS. A successful empty Ads period shows verified `$0` spend / attributed sales / orders. Unlinked KDP says **Not linked** and shows **—** royalties / orders, not `$0`. A later live self-scope fetch with no campaigns showed Ads **Setup incomplete** and all Ads money as **—**.

Partial failure: `data-map-partial-error.png` · PASS. Amazon Ads remains Available while KDP says **Couldn't check**. A KDP query failure is not rendered as Not linked or zero.

Admin view-as: `data-map-viewas-blocked.png` · PASS. Direct Supabase counts and KDP reads are not safely customer-scoped, so the screen blocks rather than mixing the admin's data with selected customer profiles. The query key still includes signed-in user, self/customer scope, selected profile IDs, and date; previous data is disabled.

Device: iPhone 16e · Light · Default  
Screenshot: `data-map-small-light.png`  
Result: PASS for the leftover customer view-as empty state on this disposable sim (D79). Long “Customer coverage unavailable” copy wraps without horizontal clipping. Populated source-card first viewport was re-verified on iPhone 17 Auth QA.

Device: iPhone 17 Auth QA · Dark · `data-map-standard-dark.png` · PASS. Backgrounds, cards, date control, status tones, copy, and buttons use theme surfaces. Text names every state; green/orange/red is never the only signal.

Device: iPhone 17 Auth QA · XXXL · `data-map-standard-largetype.png`, `data-map-standard-largetype-bottom.png` · PASS. Source names, statuses, explanations, metrics, actions, count rows, and profile names grow and wrap. Scroll-to-end verifies Selected period and Selected profile scope remain readable.

Navigation: `data-map-nav-sync.png`, `data-map-nav-accounts.png` · PASS. **View Amazon Ads sync** opens `/more/sync`; **Open Amazon Accounts** opens `/more/accounts`; stack Back returns to Data coverage. No Sync Now, account mutation, or KDP mutation was invoked.

Loading/error/empty: initial query uses `ScreenSpinner`; unexpected whole-query failure uses `RetryState`; source fetches and count checks settle independently. Available Ads remains on screen if KDP fails. Guest, no selected profile, admin view-as, source missing, period empty, source error, and count error all have distinct copy.

Accessibility: source status headers are grouped into concise summary labels, including the KDP/iPhone boundary. Source actions are full-width ≥44pt buttons with destination hints. Count and profile rows expose combined labels; decorative status symbols are hidden from accessibility. Speech was not run.

Performance: one React Query request coordinates the existing reads with `Promise.allSettled`; independent count requests run in parallel. The fixed-length diagnostic uses one `ScrollView`, memoized scope partitions, no nested scrolling, no animations, and no new backend aggregate.

Fixture note: populated/missing/partial states were injected into React Query at runtime on disposable simulators. No source credentials, Supabase rows, sync jobs, Amazon entities, KDP links, or production data were changed.

`DATA MAP UI: PASS`

---

### Rule activity
Route: `/more/rule-history` · source: `frontend/app/more/rule-history.tsx` · user-facing title: **Rule activity**.

Architecture/device truth: this is recent execution history for the signed-in user's Rules that apply to the selected profiles. It is not the Rules catalog, builder, BidBot activity, or a live recommendation queue. `[id]` on `/more/rule-detail/[id]` is an **execution ID**. The list has no Amazon writes.

Before: a three-stat hero (Rules run / Changes made / Needs review) plus All/Changes/Issues chrome sat above day-grouped cards. Status collapsed to green check vs warning. Failed runs with 0 `entities` said **No changes needed**. Query errors used the empty copy. Admin view-as was not blocked, so the signed-in user's history could appear under a customer. First useful row sat below ~180pt of chrome.

After: **Recent activity. Newest first.** then the first execution. No summary hero, no filter chrome, no current WHEN/THEN. First row starts around **~96pt** under the navigation title.

Device: iPhone 17 Auth QA · Light · Default · runtime-only history fixture  
Screenshot: `rule-activity-standard-light.png`  
Result: PASS. Rows are executions of possibly the same Rule. Status text is **Completed · No changes needed**, **Partial fail · 12 changed · 2 failed**, **Failed · This run failed**, **Running · This run is still in progress**, **Completed · 4 changed**, **Reapplied · 3 changed**. Long Spanish/punctuation Rule names wrap. No execution IDs. No Revert/Reapply.

Device: iPhone 16e · Light · Default · `rule-activity-small-light.png` · PASS populated fixture after leftover view-as was cleared. First viewport shows Recent activity + the first execution. Long names wrap; no horizontal clip.

Admin view-as: `rule-activity-viewas-blocked.png` · PASS. `fetchRuleExecutions` is signed-in-user scoped, so customer view-as is blocked instead of showing the admin's runs under customer context.

Device: iPhone 17 Auth QA · Dark · `rule-activity-standard-dark.png` · PASS. Cards, separators, timestamps, and status text use theme surfaces. Status meaning is in the words, not only green/orange/red.

Device: iPhone 17 Auth QA · XXXL · `rule-activity-standard-largetype.png` · PASS. Rule names, statuses, counts, and timestamps grow and wrap. Rows expand; no clipping or font shrinking.

Navigation: `rule-activity-to-detail.png` · PASS. Opening `exec-complete-0` lands on Execution Detail with back title **Rule activity**. Status **Completed** + **No changes needed.** + Changed 0 / Failed 0. Evaluated gap stays labeled. Revert/Reapply remain on detail only.

Loading/error/empty: initial no-cache uses `ScreenSpinner`; cached rows stay during refetch; empty-cache error uses `RetryState` (**Couldn't load rule activity**); refresh failure keeps rows + **Couldn't refresh**. Guest, no selected profile, view-as, and true empty (**No rule activity yet**) are distinct. Pull-to-refresh and the header refresh control only refetch history. They do not run Rules.

Accessibility: each row is one button with a combined label and hint **Opens execution details**. Decorative chevrons are hidden. Speech was not run.

Performance: capped 30-row `FlatList`, memoized primitive row, execution-ID keys, newest-first sort matching the query. Entity-hint secondary query was removed from this list.

Timezone: `executed_at` ISO instants render with device-local `toLocaleString` (same as Execution Detail D35). Not Amazon-profile-local.

Historical name: list shows the current joined Rule name. No immutable name snapshot exists.

Fixture note: populated statuses were injected into React Query at runtime on disposable simulators. No Rule was created, enabled, or run. No Revert/Reapply was invoked. No source credentials or production rows were changed.

`RULE ACTIVITY UI: PASS`

---

## Remaining coverage (inventory 2026-08-23)

More Root, Amazon Accounts, Sync, Bid bot, Settings, Authentication, My Account, Negatives, Data coverage, and Rule activity already had dedicated device evidence. Remaining Device + Accessibility Gaps on already-PASS screens is now closed. See `IOS_REMAINING_COVERAGE.md`.

`REMAINING IOS COVERAGE: MAPPED`
`DEVICE + ACCESSIBILITY CLOSURE: PASS`
`NOTIFICATION INFRASTRUCTURE: PASS`
`FINAL RELEASE-WIDE REGRESSION: PASS`

---

## QA-environment storage (not product code)

Documented before copy:

1. **AsyncStorage** `RCTAsyncLocalStorage_V1`  
   Source: iPhone 17 `…/BFECFCB9-85E2-4739-B6C9-DDD7FA908C4C`  
   Dest: 16e `…/2D11891D-9CCD-4B9F-A195-F9C0A22ACF43`, Max `…/9E76EA0F-508F-43E0-AC02-D706FE44D14E`  
   Why: session, `selectedProfiles`, `adminFilterUserId`, query cache.

2. **Admin filter restore on iPhone 17**  
   `inteliads.adminFilterUserId` = `36f93377-c369-41c4-bec1-107a891464cd`  
   Why: without it, Campaigns queried `self` and returned 0 rows.

3. **Nest tokens** via Metro inspector → `expo.modules.ExpoSecureStore`  
   Keys: `inteliads.rulesApi.accessToken` / `refreshToken`  
   17 → 16e / Max, then relaunch those apps.  
   Why: empty lists on 16e/Max were missing Nest tokens, not a layout bug. Encrypted keychain `genp` copy does not work.

4. **2026-08-23 iPhone 17 session restore**  
   iPhone 17 launched signed-out. Copied `RCTAsyncLocalStorage_V1` **from iPhone 16e → iPhone 17** (same keys as above). Tokens were not printed or committed. 16e already had a valid Nest/admin session; that is why Targets 16e was populated without a fixture.

Did not modify `.env`, auth code, or hardcode credentials.

---

`CORE DEVICE QA: PASS`

`DEVICE + ACCESSIBILITY CLOSURE: PASS`

`NOTIFICATION INFRASTRUCTURE: PASS`

`FINAL RELEASE-WIDE REGRESSION: PASS`

Local test notification remains the Settings UI device proof. Notification routing is a code contract: allowlisted taps, token detach, no Nest sender. Live APNs is not claimed. See `IOS_NOTIFICATION_INFRASTRUCTURE_AUDIT.md`.

2026-08-23 representative smoke (not a full recapture): `regression-overview-standard-light.png`, `regression-campaigns-standard-light.png`, `regression-targets-standard-light.png`, `regression-books-standard-light.png`, `regression-more-standard-light.png`, `regression-settings-standard-light.png`, `regression-bidbot-standard-light.png`, `regression-bidbot-standard-dark.png`, `regression-campaigns-small-light.png`, `regression-overview-small-light.png` (16e restored Targets stack), `regression-more-small-light.png`. D15 debugger toast present (dev-only). Settings footer on the smoke bundle may lag `settingsContract.ts` (Campaigns / Book / Settings).

All required leftover VoiceOver / Ad Groups dark / mutation-detail / 16e Targets items have device evidence. No unresolved product P0/P1 on otherwise-PASS screens. D5 empty Nest catalog and D12 real search-term remain P2 QA/data. D13 combined Targets row is closed.
