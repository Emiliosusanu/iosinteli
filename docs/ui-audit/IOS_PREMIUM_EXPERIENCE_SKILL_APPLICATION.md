# iOS premium experience — skill application

Written before Home layout/performance source changes.
React Native + Expo is implementation authority. Apple HIG is review authority.
SwiftUI patterns are not translated literally.

Project Expo skill folders were missing from this checkout. Official
`expo/skills` SKILL.md files and `claude-code-apple-skills-main` modules were
read in full before edits.

---

SKILL
`vercel-react-native-skills`

KEY RULES USED
Never `&&` with falsy numbers. Strings only in `Text`. No scroll position in
`useState`. Animate transform/opacity only. Pressable over Touchable. Native
tabs. Hoist list callbacks. Tabular numbers via hoisted formatters.

CURRENT INTELIADS VIOLATION
Home still uses `TouchableOpacity` for most chrome. `FadeOnChange` wraps the
entire Dashboard and replays a 220–260ms fade/translate on every period/profile
key. Overview Week/Month chrome lives next to independently padded cards.

SOURCE FILES AFFECTED
`frontend/app/(tabs)/index.tsx`
`frontend/app/(tabs)/_layout.tsx`

INTENDED FIX
Keep `FadeOnChange` off the high-frequency Dashboard tree. Use one page inset.
Do not add tab-slide animations. Do not store scroll Y in state.

---

SKILL
`expo-animation`

KEY RULES USED
Tab switches: no custom slide (`animation: 'none'`). Press feedback 100–150ms.
Reduced motion ships with the animation. Haptics once per user action, never
on scroll/refresh. Transform/opacity only. Judge feel on a Release device.

CURRENT INTELIADS VIOLATION
Tabs use `animation: "fade"`. `FadeOnChange` uses RN `Animated` with hardcoded
220/260ms and replays on `dashboardTransitionKey`. Pull-to-refresh haptics and
card-open haptics are mixed with navigation.

SOURCE FILES AFFECTED
`frontend/app/(tabs)/_layout.tsx`
`frontend/app/(tabs)/index.tsx`
`frontend/src/lib/theme.ts` (`motion` tokens)

INTENDED FIX
Semantic motion tokens (`interactionFast`, `contentUpdate`). Tab animation none.
No entrance replay on tab back. Today↔7D is instant cached state, haptic
`selection` only.

---

SKILL
`expo-design-system`

KEY RULES USED
One theme. Every repeated visual value is a token. 4-point grid. Screen edge
padding is one step. Components import tokens; screens do not invent 16/18/20/22.

CURRENT INTELIADS VIOLATION
`theme.spacing` exists, but Home also hardcodes `PAGE_PAD=16`, `CARD_RADIUS=10`,
and StyleSheet gaps of 5, 6, 7, 9, 11, 13, 14. `actionReviewCard` padding 13 vs
`profitCard` padding 16.

SOURCE FILES AFFECTED
`frontend/src/lib/theme.ts`
`frontend/app/(tabs)/index.tsx`
`frontend/src/components/DashboardSurface.tsx`

INTENDED FIX
`dashboard` tokens: `pageInset`, `sectionGap`, `cardPadding`, `compactGap`,
`metricGap`, `cardRadius`, `controlHeight`. All primary Home surfaces consume
them.

---

SKILL
`expo-native-ui`

KEY RULES USED
HIG spacing. `borderCurve: 'continuous'`. Gap over margin. Tabular nums for
metrics. `contentInsetAdjustmentBehavior` / safe areas. Prefer `@expo/ui`
segmented control. 44pt tap targets. Semantic colors for dark mode.

CURRENT INTELIADS VIOLATION
Cards omit `borderCurve`. Header chip `hitSlop` 6. Icon chips 30×30 without
guaranteed 44pt hit area on the title row action. Mixed Ionicons names mapped
late to SF Symbols.

SOURCE FILES AFFECTED
`frontend/src/components/DashboardSurface.tsx`
`frontend/src/components/ios/Native.tsx`
`frontend/app/(tabs)/index.tsx`

INTENDED FIX
Shared surface with continuous corners + hairline structure border (not stacked
shadows). Header row `minHeight` 44. Today/7D uses full-width `IOSSegmentedControl`.

---

SKILL
`expo-router`

KEY RULES USED
Native stack/tabs. Do not remount expensive trees on every blur. Screen titles
from navigation where possible. No JS tab slide.

CURRENT INTELIADS VIOLATION
`lazy: true` delays first tab mount (acceptable) but Home itself reconstructs
the account with many queries after snapshot. Custom sticky header instead of
native large title (kept: Dashboard needs profile + period chrome).

SOURCE FILES AFFECTED
`frontend/app/(tabs)/_layout.tsx`
`frontend/app/(tabs)/index.tsx`

INTENDED FIX
Keep `freezeOnBlur`. Stop Home from fetching P2/P3 before first paint.
Tab animation none.

---

SKILL
`expo-ui`

KEY RULES USED
Default to `@expo/ui` for segmented pickers. `Host` required. Do not rebuild
segmented controls in JS when native is available. `List` is not for large data.

CURRENT INTELIADS VIOLATION
Today/7D and Month/Week sit in `minWidth: 128` side slots, so the native picker
is not full-rail and does not read as a centered iOS control.

SOURCE FILES AFFECTED
`frontend/src/components/ios/Native.tsx`
`frontend/app/(tabs)/index.tsx`

INTENDED FIX
Month/Week and Today/7D occupy the page rails at `controlHeight`. Cached switch
must not show a spinner.

---

SKILL
`make-interfaces-feel-better`

KEY RULES USED
Optical over geometric centering. Tabular numbers. 44pt hit area. Scale on
press 0.96 max. No entrance animation on every navigation. Concentric radii.
Motion restraint on high-frequency actions.

CURRENT INTELIADS VIOLATION
Today/7D is right-aligned beside “Ads”, so the control is not optically
centered. `FadeOnChange` replays on period change. Nested radii 10 on card and
9 on icon chip with 16 padding (not concentric).

SOURCE FILES AFFECTED
`frontend/app/(tabs)/index.tsx`
`frontend/src/components/DashboardSurface.tsx`

INTENDED FIX
Center Today/7D on the rails. No Dashboard entrance replay. Header:
icon / title / flex / action. Pressable + hitSlop to 44.

---

SKILL
Apple `ios-development` / `ui-review` / `hig-checklist`

KEY RULES USED
44pt targets. Consistent system spacing. Dynamic Type must reflow, not clip.
Semantic colors. Loading must not replace valid content.

CURRENT INTELIADS VIOLATION
Magic-number padding. First viewport spends height on a second profit card
plus unused funnel before the first operational list. Skeleton/spinner possible
when profiles are hydrating even if a Home snapshot exists.

SOURCE FILES AFFECTED
`frontend/app/(tabs)/index.tsx`

INTENDED FIX
One inset. First viewport: scope, Today/7D, core totals, freshness. Do not
replace cached Home with a spinner.

---

SKILL
Apple `accessibility-audit`

KEY RULES USED
Labels on icon-only controls. Dynamic Type. Contrast. VoiceOver order matches
visual order.

CURRENT INTELIADS VIOLATION
Some icon chips rely on parent labels. Metric strips already have labels; keep
them. `adjustsFontSizeToFit` on the period title shrinks important text
(violates “do not shrink text to force fit”).

SOURCE FILES AFFECTED
`frontend/app/(tabs)/index.tsx`

INTENDED FIX
Remove `adjustsFontSizeToFit` on the period label; allow wrap / two lines.

---

SKILL
Apple `navigation-patterns` / `run-device` / `run-simulator`

KEY RULES USED
Tabs are peers. Physical device is the feel authority. `devicectl` for
install/screenshot. Simulator supplements.

CURRENT INTELIADS VIOLATION
Physical iPhone 17 was recently unavailable; layout was judged from code.
That is not certification.

SOURCE FILES AFFECTED
Build/install path only.

INTENDED FIX
Release install on iPhone 17 PRO Emiliano after the first geometry pass.
Do not write geometry PASS from source alone.

---

## Applied in source (after this document)

These are the source edits that followed the audit. Physical certification is
still required.

| Skill | Applied |
| --- | --- |
| vercel-react-native-skills | No Home entrance replay. Tabular metrics. No scroll-Y state. |
| expo-animation | `motion` tokens. Tab animation none. Reduce Motion on value text. |
| expo-design-system | `dashboard` tokens. `DashboardSurface`. |
| expo-native-ui | Continuous corners, hairline surfaces, 44pt header row. |
| expo-router | `freezeOnBlur` kept. `animation: "none"`. |
| expo-ui | Full-rail Today/7D and Month/Week segmented controls. |
| make-interfaces-feel-better | Centered date + full-rail period controls. No shrink-to-fit. |
| Apple HIG modules | ACoS chip stays `—`. No TestFlight. No iPhone 14 install. |

---

## Motion system pass (2026-08-25)

Purpose gate from `expo-animation`: tab switches stay `none`. Card press is
feedback. Today/7D is state indication. Metric text is preventing a jarring
change. First Home reveal is once per JS session. Chart scrub haptic is
selection only.

Rejected: collapsing-header scroll worklet, SVG path draw-on, Recent Activity
widget (not on Home), ACoS color system, glass on cards, haptic on row
navigation, endless sync spin.
