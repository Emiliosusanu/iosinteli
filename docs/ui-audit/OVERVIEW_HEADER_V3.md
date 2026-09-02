# Overview Header Redesign V3

**Branch:** `feat/ios-release-candidate`  
**Scope:** Top/header controls on Overview only. Widget bodies unchanged.

## Before issues

1. **Three stacked rows** — profile/currency/sync, date nav, full-width Month/Week segmented control consumed ~132pt+ before the first widget.
2. **Boilerplate segmented bar** — full-bleed `IOSSegmentedControl` read as generic dashboard chrome, not premium product.
3. **Weak hierarchy** — profile, sync, and period competed visually; date window did not read as the primary time context.
4. **Disconnected sync semantics** — background Amazon sync could read like dashboard refresh (addressed in prior period-honesty pass; header now surfaces distinct copy via sync pill).
5. **Period transition opacity** — date label did not communicate loading/updating state at the control layer.

## Design goals

- **Two rows max** above Net Royalties.
- **Compact premium control bar** on charcoal/elevated surface.
- **Clear priority:** account → sync → time window → period mode.
- **Native iOS feel** with restrained motion and 44pt navigation targets.
- **Data honesty** — header shows Loading/Updating when period queries are not settled.

## Skill principles applied

| Skill / guidance | Application |
| --- | --- |
| **expo-design-system** | New tokens in `theme.ts`: `headerShellRadius`, `headerShellInset`, `headerRowGap`, `headerControl`. No magic numbers in screen. |
| **expo-animation / motion discipline** | 140–200ms period label fade/shift; sync dot pulse only while Syncing/Refreshing; `useReduceMotion()` respected. |
| **make-interfaces-feel-better / vercel RN polish** | `PressableScale` on all taps; tabular nums on currency; transform/opacity only (no layout animation). |
| **expo-native-ui / iOS HIG** | 44pt chevron hit areas; tablist/tab roles on period toggle; VoiceOver labels on profile, currency, sync, period. |
| **performance-first UI** | Single header component, memo-friendly props, no blur stacks, interval cleared on unmount. |
| **INTELIADS anti-slop** | No glass abuse, no hero title, no neon; InteliAds blue accent on selected period segment border only. |
| **Data honesty (period isolation)** | `periodLoading` / `periodRefreshing` drive date meta line; financial placeholders unchanged below. |

## Files changed

| File | Change |
| --- | --- |
| `frontend/src/components/OverviewHeaderV3.tsx` | **New** — two-row compact header |
| `frontend/app/(tabs)/index.tsx` | Wire V3 header; remove legacy three-row stack |
| `frontend/src/lib/theme.ts` | Header V3 dashboard tokens |
| `frontend/tests/overview-header-v3.test.js` | **New** — structure, a11y, period testIDs |
| `frontend/tests/segmented-control-a11y.test.js` | Assert V3 period toggle retains tab roles |
| `docs/ui-audit/OVERVIEW_HEADER_V3.md` | This report |

Legacy exports `OverviewTopRow`, `OverviewDateNav` remain in `DashboardSurface.tsx` for other screens.

## Visual decisions

- **Surface:** `background_secondary` shell, hairline border, 16pt continuous radius — reads as one instrument panel.
- **Row 1:** Profile flex chip · fixed currency chip · trailing sync pill (max 108pt).
- **Row 2:** Inline date navigator (flex) · compact Month/Week rail (fixed width ~108pt).
- **Selected period:** elevated fill + subtle blue stroke — not a floating thumb slider.
- **Typography:** 13pt profile, 14pt semibold date, 10pt meta for Loading/Updating.

## Motion decisions

- Period label: opacity 0.72 + 1pt translateY while `periodLoading`.
- Sync dot: gentle opacity pulse when compact label is Syncing/Refreshing.
- Period segment: press scale via shared `PressableScale` (100ms).

## Accessibility

- Profile, currency, sync: button roles with descriptive labels.
- Date block: header role with full period string + loading meta.
- Period toggle: `tablist` / `tab` with `accessibilityState.selected`.
- Nav chevrons: 44×44pt targets via `dashboard.headerRow`.
- Date label: `adjustsFontSizeToFit` for Dynamic Type overflow.

## Performance

- No additional React Query subscriptions in header.
- Reanimated shared values scoped to date block + sync dot only.
- Sticky header padding reduced 8→6pt; removed bottom border duplicate (shell carries separation).

## Tests

Run:

```bash
cd frontend && node --test --experimental-strip-types tests/overview-header-v3.test.js tests/segmented-control-a11y.test.js tests/home-period-isolation.test.js
```

## Physical QA (device)

- [ ] Two-row header visible; first widget closer than prior three-row stack.
- [ ] Month/Week selection matches data below (no stale bleed).
- [ ] Sync pill shows Syncing vs Synced vs Refreshing correctly.
- [ ] VoiceOver order: profile → currency → sync → period → date → widgets.
- [ ] Reduce Motion: no pulse on sync dot; period label still updates text.

## Remaining blockers

- Screenshot capture requires unlocked device + CoreDevice or manual grab.
- Currency chip still routes to accounts until dedicated currency picker exists (unchanged behavior).
