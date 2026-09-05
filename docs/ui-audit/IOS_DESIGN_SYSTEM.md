# InteliAds iOS Design System

Source of truth: `frontend/src/lib/theme.ts` plus primitives in `frontend/src/components/Primitives.tsx`.  
Do not add a second token file (`InteliSpacing`, SwiftUI styles, etc.).

Stack is React Native + Expo. Icons are SF Symbols except auth `TextInput` rows (Ionicons — Host/SymbolView steals taps).

---

## Layout

| Token | Value | Use |
| ----- | ----- | --- |
| `layout.pagePad` / `spacing.screen` | 16 | Page and list edges |
| `spacing.card` | 16 | Card inner padding |
| `layout.filterPadTop` | 8 | Filter stack under the header |
| `layout.filterGap` / `layout.listGap` | 8 | Related controls; list row gap |
| `layout.tabClearance` | 120 | Scroll bottom under the tab bar |
| `layout.minTap` | 44 | Hit area. Compact visuals may be smaller with `hitSlop` |
| `layout.headerTitleSize` | 17 | Stack and SubScreen titles |
| `layout.rowAccent` | 4 | Book/campaign color bar |
| `layout.chartHero` | 160 | Overview profit chart |
| `layout.coverWidth` × `coverHeight` | 52 × 70 | Book / ASIN thumb |

Spacing scale: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40  
(`xxs` `xs` `tight` `sm` `md` `lg` `section` `xl` `xxl` `xxxl`)

Related items stay on 4–8. Groups use 12–16. Unrelated sections use 20–24.

---

## Radius

| Token | Value | Use |
| ----- | ----- | --- |
| `radii.xs` | 4 | Dots, thin bars |
| `radii.sm` | 8 | Covers, small wells, compact chips |
| `radii.md` | 10 | Cards, buttons, search, filters |
| `radii.lg` / `xl` / `sheet` | 16 | Sheets, large grouping |
| `radii.pill` | 9999 | Status pills only |

No 22–32 “SaaS” rounding. No card shadows. Grouping is background + hairline.

---

## Typography

Weights in a component: regular + one 600. Avoid 700/800 next to 600.

| Role | Style | Size / weight |
| ---- | ----- | ------------- |
| Screen title (More, auth) | `largeTitle` | 34 / 600 |
| Rare page title | `title1` | 28 / 600 |
| Secondary display | `title2` | 22 / 600 |
| Detail entity name | `title3` | 20 / 400 |
| Entity name in a row | `headline` | 17 / 600 |
| Body / buttons | `body` / `headline` | 17 |
| Supporting copy | `callout` / `subhead` | 16 / 15 |
| Metadata | `footnote` / `caption1` | 13 / 12 |
| Eyebrows, chips | `caption2` | 11 / 500 |
| Primary money (Overview) | `metric_massive` | 40 / 300 tabular |
| Primary metric in a card | `metric` | 22 / 600 tabular |
| Inline / row money | `metric_compact` | 17 / 600 tabular |

### Semantic levels

- **A — Decision data:** profit, spend, royalties, ACoS, bid → `metric_massive` / `metric` / `metric_compact`
- **B — Entity names:** campaign, keyword, book → `headline` (rows), `title3` (detail)
- **C — Supporting metrics:** orders, clicks, CTR → `MetricStrip` (caption + tabular headline)
- **D — Metadata:** match type, ASIN, sync time → `caption1` / `footnote`
- **E — Helper:** chart axis, legal → `caption2`

Numbers that scan in columns use `fontVariant: ['tabular-nums']` (already on metric styles and `MetricStrip`).

Money format is `formatCurrency` (`$1,099.40`). Compact lists may use `$1.1K`. Percent is `18.2%`. Do not mix `$ 1099.4` and `1,099.40 $`.

---

## Color

iOS system palette. Light grouped gray `#F2F2F7` / white cards. Dark `#000` / `#1C1C1E`.

| Token | Meaning |
| ----- | ------- |
| `tone_good` | Profit, success, converting, safe ACoS |
| `tone_warning` | Needs review, high ACoS, spend (cost, not failure) |
| `tone_danger` | Loss, waste (spend with 0 orders), errors |
| `tone_primary` | Selection, links, brand |
| `tone_product` | Product/purple accents (rules, some menu icons) |
| `tone_placement` | Product-pages placement (not danger red) |
| `tone_inactive` | No signal, disabled |
| `text_primary` / `secondary` / `tertiary` | Content → metadata → chrome |
| `text_inverse` | Text on filled brand buttons |

ACoS color uses `acosTone()` (below target = good, near = warning, above = danger). Do not color a metric green only because it went up.

Status is never color-only: verdict text + `ToneDot` / icon.

---

## Components

### Cards

`SectionCard` and `ListCard`: secondary background, radius 10, padding 16, no shadow.  
Optional 4pt left accent for book/campaign identity.  
Do not nest cards.

### Rows

One family: `ListCard` + `headline` name + `caption1` 600 verdict + `MetricStrip` + optional switch/bid.  
Campaigns, Targets, Books, Ad groups share this.

### Filters

`FilterChrome` on every list. Search + at most two segmented rows. Date lives in TopBar / Overview stepper, not a third chip row.

Overview Month | Week is intentional (closed P&L period). Other screens use the shared date sheet.

### Buttons

`PrimaryButton` / `SecondaryButton` → `IOSButton`. One filled action per context. Destructive uses `tone_danger`. Label 600, `text_inverse` on fill. Radius 10, min height 50.

### Badges

`Pill`: one status per row when the switch does not already say it. Match type or strategy is enough. No ACTIVE + WINNER + US + SP stacks.

### Charts

Height 160 on Overview. Daily charts stay inside `SectionCard`. Gauge/budget rings use theme tones, not Tailwind hex.

### Selectors

Native `IOSSegmentedControl`, `IOSSearchBar`, profile/date sheets. No custom switches.

### Settings / More

`IOSGroupedSection` + `IOSSettingsRow`. More uses a large title. Pushed settings do not look like the dashboard.

---

## States

| State | Treatment |
| ----- | --------- |
| Success | `tone_good` + check icon + short text |
| Warning | `tone_warning` + triangle. Local, not full-screen |
| Error | `RetryState` for page load. Widget errors stay in-card |
| Neutral / empty | `EmptyState` / `IOSUnavailable`: title, one-line why, optional action. No giant illustration |
| Loading | `ScreenSpinner` for a whole list. Progressive on Overview (show what is ready) |
| Zero | Render `0` / `$0.00`. Missing is `—` |
| Disabled | 50% opacity on the control, keep the label readable |
| Selected | Segment fill + `tone_primary` check in sheets |
| Sync | Overview pill: OK / Syncing / Issue. Sync screen uses `SyncStatusCard` |
| Reduce motion | `useReduceMotion()` — skip list springs and auth press scale |

Guest mutations: “Sign in to change bids.” Plan lock: “Manage your plan at inteliads.io.”

---

## Motion and haptics

Restrained fade / 240–280ms. No stagger fly-in when Reduce Motion is on.  
Light impact on filter/sort. Medium on row open and successful bid apply. None on scroll.

---

## Navigation

- Tabs: Overview, Campaigns, Targets, Books, More. Inline titles via `TopBar` except Overview (sticky context) and More (large title).
- Pushed screens: `SubScreen`, 17/600 title, no second `PageHeader`.
- Back title empty. Date bar only when `showDateRange`.
