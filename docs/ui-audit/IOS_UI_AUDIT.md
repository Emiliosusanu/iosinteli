# InteliAds iOS UI Audit

Audit date: 2026-08-22  
Stack: React Native + Expo Router + TypeScript (`frontend/`)  
Skill: `.claude/skills/redesign-ui/SKILL.md`

This is a consistency and hierarchy pass, not a redesign. Business logic, fetches, auth, sync, routes, and `testID`s stay as they are.

---

## Skill conflicts (documented, not overridden blindly)

| Skill says | Project principle kept | Why |
| ---------- | ---------------------- | --- |
| Icons are Ionicons | SF Symbols via `SFSymbol` / `sfFromIonicon`, except auth `TextInput` rows | Auth Host/SymbolView steals taps. Everywhere else SF Symbols match native iOS. |
| Swift-flavored prompt (`.largeTitle`, SwiftUI previews, `InteliSpacing`) | Existing `theme.ts` + `Primitives.tsx` | Do not invent a second token system. |
| Tab screens may use `PageHeader` | Tab screens use `TopBar`; Overview uses its own sticky header | Overview already compresses context into the first viewport. |
| Subtle card shadows | `SectionCard` has no shadow | Elevation comes from grouped backgrounds, not drop shadows. |
| Suggested future tabs (Automate, Books off the tab bar) | Current tabs unchanged | Product-map IA is out of scope. |

Intended product principle: one native iOS ads app. Tokens live in `frontend/src/lib/theme.ts`. Shared chrome lives in `Primitives.tsx`, `TopBar.tsx`, `SubScreen.tsx`, and `ios/Native.tsx`.

---

## 1. Application inventory

### Root / chrome

| Surface | File | Notes |
| ------- | ---- | ----- |
| Splash / route gate | `app/_layout.tsx`, `SplashVideo.tsx` | Branded splash, then auth gate. Notification tap routes here. |
| Boot spinner | `app/index.tsx` | Hardcoded `#007AFF` / white. |
| Tab bar | `app/(tabs)/_layout.tsx` | Overview, Campaigns, Targets, Books, More. Blur tab bar. |
| Tab header | `TopBar.tsx` | Title + profile sheet + date sheet. Used on list tabs except Overview. |
| Pushed header | `SubScreen.tsx` | Native stack title. Optional date bar. |
| Native controls | `ios/Native.tsx` | Search, segments, grouped settings, buttons, empty. |
| Shared primitives | `Primitives.tsx` | Cards, pills, metrics, empty/retry, buttons. |
| Entity body | `EntityDetail.tsx` | Parent chips, metric strips, funnel, daily chart. |
| Money editors | `Mutations.tsx` | Bid/budget modal, state switch. |
| Charts | `Charts.tsx` | Profit, daily, funnel, ACoS gauge, budget ring. |
| Dynamic Island widget | `DynamicIsland.tsx` | Not mounted. Decorative gradients. Leave unused. |

### Tabs

| Tab | Route | First viewport |
| --- | ----- | -------------- |
| Overview | `(tabs)/index.tsx` | Account chip, date navigator (Month/Week), sync pill, net profit, chart, royalties/spend/margin. |
| Campaigns | `(tabs)/campaigns.tsx` | Search, Active/Paused, sort, campaign cards. |
| Targets | `(tabs)/targeting.tsx` | Type segment, search, perf + sort, keyword/ASIN/auto/category/placement rows. |
| Books | `(tabs)/products.tsx` | Search, Profit/Spend/ACoS/Orders, book cards. |
| More | `(tabs)/more.tsx` | Large title, account banner, grouped Settings-style menu. |

### Auth / onboarding

| Screen | File |
| ------ | ---- |
| Welcome | `auth/welcome.tsx` |
| Login | `auth/login.tsx` |
| Signup | `auth/signup.tsx` |
| Forgot | `auth/forgot.tsx` |
| Reset | `auth/reset.tsx` |
| Auth chrome | `components/auth/AuthChrome.tsx` |

### Detail

| Screen | File |
| ------ | ---- |
| Campaign | `campaign/[id].tsx` |
| Keyword | `keyword/[id].tsx` |
| Product target | `target/[id].tsx` |
| Search term | `search-term/[id].tsx` |
| Book | `product/[asin].tsx` |
| Ad group | `more/ad-group/[id].tsx` |
| Rule detail | `more/rule-detail/[id].tsx` |

### More / secondary

| Screen | File |
| ------ | ---- |
| Bid bot | `more/bid-bot.tsx` |
| Ad groups | `more/ad-groups.tsx` |
| Negatives | `more/negative-targeting.tsx` |
| Search terms | `more/search-terms.tsx` |
| Rules | `more/automation.tsx` |
| New rule | `more/rule-create.tsx` |
| Rule activity | `more/rule-history.tsx` |
| Sync | `more/sync.tsx` |
| Data map | `more/data-map.tsx` |
| Amazon accounts | `more/accounts.tsx` |
| Settings | `more/settings.tsx` |
| My account | `more/account.tsx` |

### Sheets / modals / menus

| Surface | Where | Purpose |
| ------- | ----- | ------- |
| Profile picker modal | `TopBar.tsx` | Account / marketplace / customer (admin). |
| Date range sheet | `TopBar.tsx` | Presets + custom from/to. |
| Bid / budget editor | `Mutations.tsx` | Money or percent. |
| Account nickname | `more/accounts.tsx` | Rename profile. |
| Search-term actions | `more/search-terms.tsx` | Native ActionSheet: add / negate. |
| Sign-out confirm | `more/account.tsx` | Destructive alert. |
| Guest mutation alerts | Several More screens | “Sign in to change bids.” |

### Widgets / row families (current, not yet unified)

| Family | Screens |
| ------ | ------- |
| Campaign card | Campaigns, targeting placements, campaign detail children |
| Targeting row | Keywords, ASINs, auto, category |
| Book row | Books tab, Overview top books |
| Settings row | More, Settings, Account |
| Metric strip | Campaigns, Targets, Books, details, Bid bot |
| Sync pill / card | Overview header, Sync screen |

### States present

Empty, retry, spinner, guest, admin-no-profile, pull-to-refresh, bid editor, enabled/paused switch.  
No dedicated offline banner. Zero data and missing data are mostly distinct (`—` vs `0`).  
Overview leftover helpers (funnel, placement mix, ads engine cards) are still in the file but not rendered — queries stay `enabled: false` for hook order.

---

## 2. Date range (documented difference)

Overview uses a Month | Week period stepper. It writes the same `dateRange` in `AppContext`.

Campaigns, Targets, Books, and pushed screens with `showDateRange` use the TopBar/SubScreen date chip (Today, 7D, 30D, custom, and the rest).

This is intentional: Overview is a closed-period P&L view. Lists need arbitrary ranges. Do not force Overview onto 7D/14D/30D chips.

---

## 3. Audit matrix

Importance: P0 critical visual/interaction · P1 major hierarchy/usability · P2 consistency · P3 polish.

| Area | Screen | Component | Current Issue | Importance | Change Required | Status |
| ---- | ------ | --------- | ------------- | ---------- | --------------- | ------ |
| Tokens | Global | `theme.ts` | Scale missing 2/6/20. No layout constants. `title1`/`title2` are 700 next to `largeTitle` 600. No placement-color token. | P1 | Extend existing theme only. Add layout, `tone_placement`, tabular metric styles, 600 titles. | Done |
| Tokens | Global | Magic numbers | 5/7/9/11/13/14/17/22/38/40/52/74 mixed across screens. | P1 | Map repeats onto the scale. Leave true one-offs. | Done |
| Motion | Global | List entrance springs | Campaigns, Books, Ad groups fly in. No `ReduceMotion`. | P1 | Skip springs when reduce-motion is on. | Done |
| Chrome | TopBar | Bar / chips | `paddingTop` 10 / `paddingBottom` 9. Sheet corners 22. Handle `#8888`. | P2 | 8 / 8, sheet 16, semantic handle. | Done |
| Chrome | TopBar | Date apply | Button label `#fff` / weight 700. | P3 | `text_inverse`, 600. | Done |
| Chrome | SubScreen | Title | 16pt vs campaign custom 15pt. | P2 | 17 / 600 everywhere. | Done |
| Chrome | Tabs | Tab bar | Fine. Labels match destinations. | P3 | Leave. | Pass |
| Chrome | Native | Button / empty | Button radius 12 vs cards 10. Empty title uses thin `title3`. | P2 | Card radius 10. Empty title `headline`. | Done |
| Chrome | Native | Grouped section | `marginTop` 22. | P2 | 20. | Done |
| Primitive | KpiTile / MetricCard / StatBadge | Numbers | Mixed 700 and no tabular on some values. KpiTile deltas treat “up” as good. | P1 | Tabular metric styles. Keep `StatBadge` inverse for ACoS. Do not invent green-up. | Done |
| Primitive | SectionHeader / PageHeader | Spacing | `gap: 7`, icon well radius 13. | P2 | 8 and `radii.md`. | Done |
| Primitive | Shared rows | List cards | Campaigns pad 14, targeting 14, books 16, ad groups 16. Accent 5 vs 4. | P1 | Shared `ListCard` + `FilterChrome` + `ScreenSpinner`. | Done |
| Overview | Home | Sticky header | Chip/sync 29–30pt tall. Nav chevrons 30×30. Arbitrary 5/7/11 radii. | P1 | Scale spacing. Expand hit slop, keep header compact. | Done |
| Overview | Home | Profit card | Icon well 42 / radius 14 competes with the number. Period label repeated under “Net profit”. | P2 | Smaller icon. Drop duplicate period line. | Done |
| Overview | Home | Top books | Title is `footnote` (too weak for entity names). Net is 14/700. | P1 | `subhead` + tabular headline. | Done |
| Overview | Home | Dead UI | Unused StatCard/funnel/placement helpers and styles still in file. | P3 | Leave this pass (queries must stay). Document only. | Deferred |
| Overview | Home | Date UX | Month/Week vs other tabs’ date chip. | — | Keep. Documented above. | Pass |
| Campaigns | List | Filters | Already compact. | P2 | Use `FilterChrome`. | Done |
| Campaigns | Row | Card | Pad 14, accent 5, status 700, extra bidding-strategy pill. | P2 | Pad 16, accent 4, status 600. Keep switch + one strategy pill. | Done |
| Campaigns | Row | Placement pills | Product share `#db2777`. | P2 | `tone_placement`. | Done |
| Campaigns | Motion | AnimatedCard | Stagger + press spring. | P1 | Honor reduce motion. | Done |
| Targets | List | Filter stack | 4 controls, `paddingTop` 12 vs 8 elsewhere. | P1 | Same filter chrome. Keep all four (they earn their place). | Done |
| Targets | Keyword row | Title | `callout`+600 vs campaigns `headline`. Status 700. | P2 | Headline + 600 status. | Done |
| Targets | ASIN row | Header | Cover 52×70 OK. Pill + ASIN + title competes. | P2 | Title first, match/ASIN as metadata. | Done |
| Targets | Loading | Spinner | `padding` 32 vs campaigns 40. | P2 | Shared spinner. | Done |
| Books | Row | Cover | 74×98 dominates the row vs profit. | P1 | 52×70, matching targeting. | Done |
| Books | Row | Title | `callout` 700. Status pill + break-even bar + 4 metrics is dense but useful. | P2 | Headline 600. Keep metrics. | Done |
| Books | Motion | ProductCard | Same stagger/spring as campaigns. | P1 | Reduce motion. | Done |
| More | Menu | Title / icons | Title pad 20. Hardcoded iOS hex (including cyan/indigo not in theme). Avatar 52. | P2 | Pad 16. Theme tones. Avatar 44. Keep large title (Settings pattern). | Done |
| Campaign detail | Hero / placements | Color / title | Header 15pt. Product placement `#db2777`. | P2 | 17pt. Token color. | Done |
| Keyword / target detail | Header | Pills | Switch plus Active/Paused pill. Status 700. Copy “Converting” vs list “Profitable”. | P2 | Drop redundant pill. 600. Say “Profitable”. | Done |
| Book detail | Placements | Color | `#db2777`. | P2 | Token. | Done |
| Entity | Metric card | Shared | Already a good strip. Radius 10. | P3 | Use tokens. | Done |
| Bid bot | Screen | Cards | Uses SectionCard. Auto-mode language is clear. | P2 | Token spacing only. | Done |
| Ad groups | Rows | Motion / type | Animated entrance. Title `callout` 600. State pill + switch. | P2 | Reduce motion. Headline. Keep switch; pill is redundant but state-colored — drop pill. | Done |
| Search terms | List | Filters + actions | Native ActionSheet (good). Card style local. | P2 | Shared card/filter chrome. | Done |
| Negatives | List | Rows | Local list styling. | P2 | Shared padding. | Done |
| Rules | List / create | FAB / chips | White-on-blue plus `#fff` thumbs. Create screen chippy. | P2 | `text_inverse`. Leave rule logic. | Done |
| Sync | Screen | Status cards | Already uses SyncStatusCard. | P3 | Token pass. | Done |
| Data map | Screen | Cards | Fine density. | P3 | Token pass. | Done |
| Accounts | Screen | KDP / Amazon | Connection state present. Nickname modal. | P2 | Token pass. Keep copy. | Done |
| Settings | Screen | Form | Native grouped form. Good. | P3 | Token pass. | Done |
| Account | Screen | Hero | Email 700. Plan + Active pills (Active is redundant). | P2 | 600. Drop Active pill. | Done |
| Auth | Fields | Icons | Ionicons by design. | — | Keep. | Pass |
| Auth | Motion | Springs | `springify` on enter + press scale. | P2 | Fade only; skip scale when reduce motion. | Done |
| Auth | Buttons | Label | `#fff`. | P3 | `text_inverse`. | Done |
| Welcome | Onboarding | Slides | One idea per slide. Ionicons OK here. | P3 | Inverse on primary. | Done |
| Charts | ACoS / budget | Hardcoded Tailwind | `#22c55e` `#eab308` `#ef4444` `#3b82f6`. | P1 | Theme tones. Tabular values. | Done |
| Charts | Funnel / daily | Height | Reasonable. | P3 | Leave heights. | Pass |
| Color | Global | Status | Green/orange/red already semantic via `acosTone`. Spend uses warning (not danger). | — | Keep. Placement product gets its own token, not danger red. | Done |
| A11y | Contrast | `text_tertiary` | 30% white/black — weak for status copy if misused. | P1 | Status uses tone colors. Metadata stays secondary, not tertiary, on entity names. | Done |
| A11y | Dynamic Type | Grids | Metric strips stay 4-across; `adjustsFontSizeToFit` on values. | P2 | Do not disable Dynamic Type. Large sizes will shrink numbers. | Partial |
| A11y | Color-only | ToneDot | Dot without text on some rows. | P2 | Rows already have a verdict string. Keep both. | Pass |
| Touch | Compact controls | Filters / chevrons / eye | Visual height < 44. | P1 | `hitSlop` / min 44 on icon buttons. Do not inflate filter chrome. | Done |
| Density | First viewport | Overview | Header + profit is the right story. | — | Tighten header; keep hero. | Done |
| Density | First viewport | List tabs | Filters consume the fold before the first row on Targets. | P1 | Compress filter spacing, not the filters. | Done |
| Copy | Empty states | Various | Mostly short. “Products failed to load” on Books. | P2 | “Books failed to load”. | Done |
| Notifications | Push → UI | Route guard | Local alerts land on Overview, not the 3 keywords. | P1 | Out of scope (routing, not pixels). Documented. | Deferred |
| Widgets | DynamicIsland | Unused | Gradient chrome. | P3 | Do not mount. | Deferred |

---

## 4. Information ranking (live screens)

### Overview (priority 5 → 1)

5 Net profit  
4 Royalties, spend, margin, chart  
3 Top books (name + profit)  
3 Spending without sales  
2 Account, period, sync  
1 Decorative profit icon  

### Campaign / Target / Book rows

5 Entity name + profit or ACoS  
4 Spend, sales/orders  
3 Verdict, bid, enable switch  
2 Match type / strategy / ASIN  
1 Extra pills  

### Bid bot

5 Recommendation and before → after bid  
4 Apply / ignore  
3 Auto-mode (off / high confidence / aggressive)  
2 Engine last run  
1 About copy  

---

## 5. This pass will change

1. Tokens and layout constants in `theme.ts` (no second design system).  
2. Shared primitives: `ListCard`, `FilterChrome`, `ScreenSpinner`.  
3. Chrome: TopBar, SubScreen, Native, Charts, Auth motion.  
4. Root tabs, then details and More screens that share the same row/metric language.  
5. Design-system and QA matrix docs after the visual pass.

Out of scope: Nest/Supabase, BidBot math, swipe actions, new tabs, APNs routing, deleting unused Overview queries.

---

## 6. This pass — done

Tokens, primitives (`ListCard`, `FilterChrome`, `ScreenSpinner`), chrome, all five tabs, entity details, Bid bot / Ad groups / Search terms / Negatives / Rules / Sync / Accounts / Data map / Account, charts, and auth motion. `tsc --noEmit` is clean.

Still deferred: unused Overview helpers (queries must stay), notification deep-link landing, unused `DynamicIsland`, on-device dark / Dynamic Type walkthrough.
