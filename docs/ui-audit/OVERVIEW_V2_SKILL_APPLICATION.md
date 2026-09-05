# Overview V2 — skill application

Written during the Overview / Home first-screen premium redesign.
Expo / React Native is implementation authority. Apple HIG is review guidance.

Official `vercel-react-native-skills`, `expo-animation`, `expo-design-system`,
`expo-native-ui`, `expo-router`, `expo-ui`, and `make-interfaces-feel-better`
SKILL.md folders are **not installed** in this checkout. Rules below are the
concrete patterns applied from prior InteliAds skill audits
(`IOS_PREMIUM_EXPERIENCE_SKILL_APPLICATION.md`, `INTELIADS_DESIGN_SKILL_APPLICATION.md`)
and Apple/iOS guidance already recorded in-repo.

Do not treat listing a skill name as compliance.

---

## SKILL
`vercel-react-native-skills`

RULE:
Never coerce numbers with `&&` into JSX. Strings only inside `Text`. Prefer
transform/opacity motion. Native tabs. Tabular numbers for money. No scroll-Y
in `useState`.

WHERE APPLIED:
`frontend/app/(tabs)/index.tsx`, `frontend/app/(tabs)/_layout.tsx`,
financial display helpers (`netRoyalties`, VerifiedValue).

BEFORE:
Mixed header chrome; Spend used oversized marketing numerals; Campaigns used a
giant full-width CTA; tab bar used custom product icons without a shared active
grammar.

AFTER:
Overview chrome uses `OverviewTopRow` / `OverviewDateNav` / shared card headers.
Metric tokens capped at controlled 28pt. Campaigns/Books use header “View all”
chevrons. Tabs stay `expo-router` Tabs with `animation: "none"`. Unknown finance
stays `"—"`.

WHY:
Keeps the operating dashboard dense and correct without RN anti-patterns that
cause blank renders or janky scroll.

---

## SKILL
`expo-animation` / motion tokens

RULE:
Animate selection/press only (150–240ms feel). Respect Reduce Motion. Do not
replay whole-screen fades on period change. No ambient float/glow.

WHERE APPLIED:
`frontend/src/lib/motion.ts` + `Motion.tsx` (`HorizonPane`, `PressableScale`,
`FirstReveal`), period haptics via `playHaptic("select")`, tab `animation: "none"`.

BEFORE:
Heavy sticky stack + full dashboard transition risked feeling theatrical.

AFTER:
Horizon switches crossfade content only. Segment presses haptic once. Active
tab uses a 4pt accent dot + tint — no bounce. Reduce Motion short-circuits
motion helpers already used by Home.

WHY:
Premium feel comes from restraint; data must remain interactive during refresh.

---

## SKILL
`expo-design-system`

RULE:
One theme. Repeated geometry is tokens (`dashboard.*`). Screens do not invent
arbitrary 13/17/19 spacing.

WHERE APPLIED:
`frontend/src/lib/theme.ts` (`palette.dark` true-black, `dashboard` rails,
`typography.metric_massive` 28, `sectionTitle`, `meta`),
`DashboardSurface` / card radius 14 / inset 16.

BEFORE:
Inconsistent header padding and oversized section titles competed with metrics.

AFTER:
`pageInset: 16`, `sectionGap: 12`, `cardPadding: 14`, `chipRadius: 10`,
`headerRow: 44`, accent edge 2pt for Net Royalties. All Overview cards share
the surface grammar with controlled variation (accent edge, attention border).

WHY:
Related widgets without identical clone cards; identity without purple AI
gradients.

---

## SKILL
`expo-native-ui` / Apple HIG

RULE:
44pt minimum targets. Continuous corners. Semantic colors. SF Symbols for
system actions; product icons for product concepts. No giant glass slabs.

WHERE APPLIED:
Profile / currency / sync chips, date arrows, segment fallbacks (`forceFallback`
for reliable XCUITest), tab BlurView intensity restrained, VoiceOver labels for
Amazon Ads Spend / KDP Royalties / Net Royalties.

BEFORE:
Profile+currency fused into one heavy chip; date nav used large empty button
blocks; Campaigns CTA was a full-width PrimaryButton.

AFTER:
Row 1: profile · currency · freshness. Row 2: lightweight date nav with 44pt
hit areas. Segment height 32 inside 44-capable pressables. Header actions are
meta + chevron.

WHY:
Native iOS operating density — controls first, not marketing hero.

---

## SKILL
`expo-router`

RULE:
File-based tabs; lazy screens; freezeOnBlur; no custom tab slide.

WHERE APPLIED:
`frontend/app/(tabs)/_layout.tsx` — Overview / Campaigns / Targets / Books /
More with InteliAds product icons + active tint.

BEFORE:
Active tab lacked a clear premium affordance; More used a generic glyph without
the shared icon wrap.

AFTER:
Active tint `tone_primary`, 4pt top accent dot, labels 10/600, height ~78 with
safe area. Product icons for four primary tabs.

WHY:
Navigation stays system-owned and readable in dark mode.

---

## SKILL
`make-interfaces-feel-better` / premium polish

RULE:
Pressed states, clear selected state, intentional empty copy, cache-first
visibility, no decorative empty UI.

WHERE APPLIED:
`PressableScale` on chrome chips; campaign empty “No campaign leaks right now.”;
books empty “No books available for this period.”; Amazon Ads footer freshness +
BidBot; Net Royalties green edge accent without glow panel.

BEFORE:
Loading copy could dominate cards; giant Campaigns button broke hierarchy;
Spend dominated half the viewport.

AFTER:
Spend leads a balanced primary row (optional compact 7D micro bars). Secondary
Orders/Sales/ACoS. Tertiary KDP/Net. Footer freshness/BidBot. Leaks summary
strip when relevant. Inline loading/meta only.

WHY:
First useful paint stays header + Amazon Ads; lower widgets do not block.

---

## SKILL
`ios-development` / accessibility-audit / navigation-patterns

RULE:
Financial-domain wording. Selected-state announcement on segments. Decorative
compact sparkline hidden from a11y when redundant. Dynamic Type tolerant
chrome (numberOfLines, flexShrink).

WHERE APPLIED:
Horizon/period `accessibilityState.selected`, Amazon Ads / Net Royalties
VoiceOver strings, tab `tabBarAccessibilityLabel`, minTap 44.

BEFORE:
Ambiguous “Sales” / “Net” risked VoiceOver confusion with Ads vs KDP.

AFTER:
Labels prefer “Amazon Ads Spend”, “Ads sales”, “KDP Royalties”, “Net Royalties”.
Period isolation tests unchanged — visual redesign only.

WHY:
Accessibility and data correctness are part of premium, not extras.

---

## First-screen audit map (pre → V2 intent)

| Region | Problem | Redesign |
| --- | --- | --- |
| Top bar | Tall sticky stack, fused filters | Compact 2-row operating chrome |
| Profile | Oversized gray block | 44pt chip + icon + chevron |
| Currency | Equal visual weight nested in profile | Separate compact currency chip |
| Freshness | Generic status | Semantic tinted sync chip |
| Date nav | Heavy arrow buttons | Lightweight 44pt arrows, stable center |
| Month/Week | Heavy segment | 32pt compact segment, forceFallback |
| Today/Yest/7D | Felt large | Same compact segment inside Ads card |
| Amazon Ads | Spend hero / sparse | Header → Spend+micro → strip → KDP/Net → footer |
| Net Royalties | Competing hero | Green edge, formula caption + period, strips |
| Campaigns | Giant CTA | Header View all + Leaks/Top/Spend + leak summary |
| Top Books | Generic title row | Editorial header + View all + cover rows |
| Tab bar | Flat inactive | Tint + accent dot, product icons |

Financial formulas, period keys, PostgREST completeness, and BidBot logic were
not changed in this pass.

---

## Physical Release status (2026-08-30)

- Release `xcodebuild` from `iosapp-inteli-phasea-read`: **BUILD SUCCEEDED**
- Embedded JS markers present: `home-campaigns-cta`, `No campaign leaks right now`
- Installed on iPhone 14 Pro (`io.inteliads.app`)
- Physical screenshot / interaction QA: **BLOCKED** — `passcodeRequired: true` at launch time
- Unit gates: `home-period-isolation`, `inteliads-icon-system`, `motion-system` **PASS**
