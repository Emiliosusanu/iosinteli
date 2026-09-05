# InteliAds iOS — Shared UI Regression (post-Targets)

Date: 2026-08-22  
Scope: primitives actually changed during Targets list QA.  
Method: git/worktree intent + recursive `frontend/` search + SE-width layout math.  
Not a simulator appearance walk.

Source of truth for “what changed in Targets”:

| Shared piece | Changed in Targets QA? | Notes |
| ------------ | ---------------------- | ----- |
| `MetricStrip` | Yes | Dropped `adjustsFontSizeToFit`. Columns follow width, font scale, and the widest value. |
| `ListCard` | No | Same padding / `radii.md` / theme surface / optional accent. |
| `FilterChrome` | No | Same page pad, 8pt top pad, 8pt gap. Targets just passed fewer children. |
| Spacing / type / radius / color tokens | No | Targets used existing `radii.sm` and `spacing.md` locally. |
| Row primitives (`Pill`, `ToneDot`) | No | Targets stopped using `Pill` on keyword match type. Shared components unchanged. |

---

## Consumers

```text
MetricStrip
├── Targets list          (tabs)/targeting.tsx          4 compact
├── Campaigns list        (tabs)/campaigns.tsx          4 compact
├── Books list            (tabs)/products.tsx           4 compact
├── Ad groups list        more/ad-groups.tsx            4 compact
├── Search terms list     more/search-terms.tsx         4 compact
├── Campaign detail       campaign/[id].tsx             4 + 4 + 2 full currency
├── Book detail           product/[asin].tsx            4 compact (header + campaign rows)
├── Ad group detail       more/ad-group/[id].tsx        4 + 2 header; 4 in kw/target/term rows
├── Keyword detail        keyword/[id].tsx              via EntityDetail (4 + 4)
├── Target detail         target/[id].tsx               via EntityDetail (4 + 4)
└── Search-term detail    search-term/[id].tsx          via EntityDetail (4 + 4)

ListCard
├── Targets
├── Campaigns      AnimatedCard > ListCard
├── Books          Animated.View > ListCard
└── Ad groups      AnimatedRow > ListCard

FilterChrome
├── Targets        type + search + filter button (+ chips when active)
├── Campaigns      search + state + sort          (3 rows, unchanged)
├── Books          search + sort                  (2 rows, unchanged)
├── Ad groups      search + state + sort sheet    (2 rows; sort in sheet when opened)
├── Search terms   search + perf + sort           (3 rows, unchanged)
└── Negatives      keywords / products            (1 row, unchanged)

Dashboard / Overview: no MetricStrip, ListCard, or FilterChrome.
```

No 3-metric `MetricStrip` exists. The only 2-metric strip is Ad group detail header (Clicks / Impr.).

---

## Checklist

Result = code + width math, not a device walk.  
`n/a` = this primitive did not change, or the column does not apply.

| Component | Consumer | Normal width | Small width | Large values | Dark mode | Dynamic Type | Result |
| --------- | -------- | ------------ | ----------- | ------------ | --------- | ------------ | ------ |
| MetricStrip | Targets | 4-up compact | 4-up @ 311pt | `$12,482.74` → 2×2 | theme tokens | 1.3 → 2×2, 2.0 → 2×2 | PASS (code) |
| MetricStrip | Campaigns | 4-up compact | same 311pt card | same ladder | theme tokens | same | PASS (code) |
| MetricStrip | Books | 4-up compact | same | same | theme tokens | same | PASS (code) |
| MetricStrip | Ad groups list | 4-up compact | same | same | theme tokens | same | PASS (code) |
| MetricStrip | Search terms | 4-up compact | same | same | theme tokens | same | PASS (code) |
| MetricStrip | Campaign detail | 4-up compact | hero ~311pt | 2×2 if full currency | theme tokens | wraps | PASS (code) |
| MetricStrip | Book detail | 4-up compact | same | same | theme tokens | wraps | PASS (code) |
| MetricStrip | Ad group detail header | 4 + 2 | 2-up always fits | 2-up stays 2 | theme tokens | 2.0 → 1-up on 2-metric if needed | PASS (code) |
| MetricStrip | Ad group kw / target / term rows | nested ~219pt | 2×2 compact | 1-col if `$12,482.74` | theme tokens | 2.0 → 1-col | DEFERRED density |
| MetricStrip | EntityDetail (kw / target / ST) | 4 + 4 | 4-up compact; 2×2 if `1,294,832` impr. | never clipped | theme tokens | wraps | PASS (code) |
| ListCard | Targets / Campaigns / Books / Ad groups | `radii.md` 10, pad 16 | unchanged | n/a | `background_secondary` | n/a | Unchanged |
| FilterChrome | Campaigns / Books / Ad groups / ST / Negatives | same footprint as before Targets | unchanged | n/a | unchanged | native 36pt controls | Unchanged |

### Value matrix (SE list card = 311pt, fontScale 1)

| Value | Columns | Notes |
| ----- | ------- | ----- |
| `$12.5K` / `18.2%` / `1,294` (compact 4) | 4 | Default list/detail |
| `$12,482.74` / `187.42%` / `1,294` | 2 | Wrap, no shrink |
| `$0.00` / `—` / `0` / `-14.8%` | 4 | Short / missing / negative |
| `1,294,832` impressions in a 4-up | 2 | EntityDetail second strip |

### Widths used

- List / detail card inner: `375 − 16 − 16 − 16 − 16 = 311`
- Ad group nested row: ~219 (tone + match pill + chevron)
- Pro Max card inner: ~398

---

## ListCard

Unchanged. No selected / disabled API. Press lives on the parent `TouchableOpacity`.

`AnimatedCard` / `Animated.View` / `AnimatedRow` wrap Campaigns, Books, and Ad groups only. They add entrance + press scale, not padding, radius, or shadow. Targets has no wrapper. Visible difference is motion, not chrome. Left as-is.

## FilterChrome

Unchanged. Targets is denser because it moved perf/sort into a sheet — that is screen code, not the primitive. Campaigns still shows three filter rows. Not a shared regression.

## Tokens

No global spacing, type, radius, or color edit in this pass. Equivalent list cards stay on `radii.md` (10). Cover `7 → radii.sm` (8) is Targets-only.

## Interaction

`MetricStrip` is display-only. Row taps, bids, switches, filters, refresh, and navigation are unchanged. Filter button on Targets is 36pt with 4pt hitSlop (44).

---

## Regressions found

| Sev | Item | Action |
| --- | ---- | ------ |
| P1 | New wrap used `%` flexBasis + 2+1 for 3-up; first-frame width guess could disagree with nested rows | Fixed in `MetricStrip`: 4→2→1 / 3→1 / 2→1, pixel cell widths, fallback = page+card pad |
| P2 | Ad group detail rows share width with a match-type `Pill`, so compact 4-up becomes 2×2 on SE | Deferred — screen QA, do not special-case the primitive |
| — | Campaigns / Books first viewport still 2–3 filter rows | Pre-existing, not this primitive |
| — | `data-mapping.test.js` 3 Overview/queries failures | Pre-existing, not UI |

## Regressions fixed

- Shared wrap rule is the same on every consumer.
- Cells use measured pixel widths when wrapped (no `%` + padding wrap glitch).
- Values keep headline size and line height. No `adjustsFontSizeToFit`. No ellipsis on numbers.

---

## Campaign Detail pass (2026-08-22)

Shared defects found while refining `/campaign/[id]`:

| Primitive | Changed? | Why | Consumers checked |
| --------- | -------- | --- | ----------------- |
| `Funnel` in `Charts.tsx` | Yes — value `800` and badge `700` → `600` | Weights were louder than the rest of the type scale. Documented in Targeting Detail; fixed here. | Campaign Detail; `EntityDetail` (keyword / target / search-term). Overview `FunnelBars` is a different local component. Other `800` weights in `Charts.tsx` (profit/net) were left alone. |
| `EntityStateSwitch` | Yes — `accessibilityLabel` + `accessibilityState` | Switch had no semantic label; status was color/track only. Mutation logic unchanged. | Campaign Detail; Campaigns list; Targets list; Keyword / Target / Ad group detail; Ad groups list. |
| `MetricStrip` | No | Full currency on Campaign Detail Outcome; existing wrap ladder handles `$12,482.74`. | Unchanged |
| `ListCard` / `FilterChrome` / `BidBudgetEditor` | No | Budget still uses the existing editor (native iOS prompt). | Unchanged |

---

## Ad Groups List pass (2026-08-22)

No shared primitive required a fix.

| Primitive | Changed? | Notes |
| --------- | -------- | ----- |
| `MetricStrip` | No | List now uses ACoS / Spend / Sales / Orders compact, same ladder as Campaigns. |
| `ListCard` / `FilterChrome` / `EntityStateSwitch` / `SubScreen` | No | Screen-only chrome: search + state up; sort in a page sheet. Entrance stagger removed in `ad-groups.tsx` only. |

---

## Device QA pass (2026-08-22)

Proven on iPhone 17 Targets list: 4-up MetricStrip collapsed so `91.8%` / `160.6%` were clipped by the next cell. `ListCard` `overflow: "hidden"` made it worse.

| Primitive | Changed? | Why | Consumers re-shot |
| --------- | -------- | --- | ----------------- |
| `MetricStrip` | Yes — root `alignSelf: "stretch"`, `width: "100%"`, `minWidth: 0` | Flex row parent gave the strip no width, so four `flex: 1` cells collapsed. | Targets list light/dark/XXXL/AXL; Campaigns list light/dark/XXXL; Campaign Detail light/dark/XXXL/AXL; Ad Group Detail light/dark/XXXL. Keyword + ASIN + Auto target light (and Keyword dark). |
| `ListCard` / `FilterChrome` / `EntityDetail` | No | Clip was the strip, not card chrome. | Unchanged |

After the fix: 4-up values fully visible at default type; XXXL / AXL wrap 4 → 2×2; numbers not clipped. Did not restore `adjustsFontSizeToFit`. Did not change the 0.65 width estimate.

Books / Search terms list / Book detail were **not** re-shot this checkpoint (out of scope). Same primitive.

## Device / a11y

Dark and Dynamic Type were rendered on iPhone 17 for the core path above. iPhone 16e / 17 Pro Max list captures failed (`Open in "InteliAds"?`). VoiceOver speech was not driven. See `IOS_DEVICE_QA.md`.
