# iOS Home geometry baseline

Authority: physical iPhone 17 PRO Emiliano.
This file records the **pre-correction** system as measured from source, plus
the intended rails. Physical X/Y were not captured this pass because the
iPhone 17 was `unavailable` (`devicectl`). Do not treat this as PASS.

Assumed logical width for source math: **440pt** (Pro Max class).
`PAGE_PAD` / `layout.pagePad` = **16**.
Derived primary width: `440 - 16 - 16 = 408`.

## Shared rails (intended)

| Token | Value |
| --- | --- |
| pageInset | 16 |
| primary widget width | 408 on 440pt |
| sectionGap | 16 |
| cardPadding | 16 |
| compactGap | 8 |
| metricGap | 12 |
| cardRadius | 12 |
| controlHeight | 36 |

## Current source (before)

Local Home constants: `PAGE_PAD = 16`, `CARD_RADIUS = 10`.
`theme.spacing.card = 16`, `theme.spacing.section = 20`, `theme.radii.md = 10`.

These do **not** share one rail in practice because inner StyleSheet values
diverge.

### Sticky header

| Field | Source |
| --- | --- |
| LEFT MARGIN | 16 (`stickyHeader.paddingHorizontal`) |
| RIGHT MARGIN | 16 |
| INTERNAL HORIZONTAL PADDING | 0 extra |
| VERTICAL GAP BELOW | 8 (`paddingBottom`) |
| HEADER BASELINE | 25pt title style unused; account chip 12pt |
| TRAILING ACTION | sync pill `maxWidth: 88`, `minHeight: 44` |
| CORNER RADIUS | chip 10, sync 10 |

Account chip and sync pill share the 16pt rail. Date row is also 16pt.

### Today / 7D (Ads snapshot card)

| Field | Source |
| --- | --- |
| LEFT / RIGHT MARGIN | 16 (FadeOnChange `paddingHorizontal`) |
| WIDTH | 408 (intended) |
| INTERNAL HORIZONTAL PADDING | 16 (`t.spacing.card`) |
| VERTICAL GAP ABOVE | 8 (`paddingTop: sm`) |
| VERTICAL GAP BELOW | 20 (`marginBottom: section`) |
| CORNER RADIUS | 10 (`styles.card`) |
| HEADER | “Ads” left, segmented `minWidth: 128` right — **not centered** |
| CONTROL HEIGHT | 36 native / fallback segmented |

### Royalties − spend (profit card)

| Field | Source |
| --- | --- |
| LEFT / RIGHT MARGIN | 16 |
| INTERNAL PADDING | 16 (`profitCard`) |
| CORNER RADIUS | 10 |
| VERTICAL GAP ABOVE | 0 (follows snapshot `marginBottom` 20) |
| METRIC GRID | two `MetricStrip` rows, not one 4-up grid |

### Action review / Campaigns / BidBot / Rules / Books

| Widget | Extra divergence |
| --- | --- |
| Action review | padding **13**, radius **10**, icon box 38, count 30 |
| Campaigns / BidBot / Rules / Books | padding 16, `CardTitle` icon chip 30×30 radius 9, default title `mb=14` |
| Action “All” | `paddingHorizontal: xs` (4) |
| Book row | `marginHorizontal: md` (12) inside a 16-padded card |

### Magic numbers still in Home StyleSheet

5, 6, 7, 9, 11, 13, 14 appear as gaps/padding independent of `theme.spacing`.

## Physical capture

DEVICE: iPhone 17 PRO Emiliano  
STATE: unavailable at baseline  
SCREENSHOT: not taken  
X/Y: not measured on glass

Re-measure after Release install before writing
`INTELIADS DASHBOARD GEOMETRY: PASS`.

## Source after first correction pass (2026-08-25)

Not physical. Do not write GEOMETRY PASS.

| Token | Value |
| --- | --- |
| PAGE LEFT/RIGHT INSET | 16 (`dashboard.pageInset`) |
| PRIMARY WIDGET WIDTH | `screen - 32` (408 on 440pt class) |
| STANDARD SECTION GAP | 16 (`dashboard.sectionGap`) |
| CARD INTERNAL PADDING | 16 (`dashboard.cardPadding`) |
| CONTROL HEIGHT | 36 (`dashboard.controlHeight`) |
| CARD RADIUS | 12 + `borderCurve: continuous` |
| HEADER ROW | 44 (`dashboard.headerRow`) |

Applied in source:
- Sticky header, date navigator, and all primary Home surfaces share `pageInset` 16.
- Today/7D is a full-rail segmented control (no trailing 128pt slot).
- Month/Week is a full-rail control under a centered date label.
- Snapshot + profit use `DashboardSurface`.
- Remaining widgets use `dashboardSurfaceStyle`.
- Action review uses the same padding/radius tokens (attention border).
- `CardTitle` is icon / title / flex / action at 28×28 / 8 radius / 44 min height.
- Period label wraps (2 lines). `adjustsFontSizeToFit` removed.

Physical X/Y, left/right pixel rails, and optical centering remain unmeasured.
iPhone 17 PRO Emiliano was still `unavailable` after this pass. iPhone 14 was
available and was **not** used.
