# InteliAds design skill application

Written during the anti-AI-slop + Net Royalties presentation pass.
Expo / React Native is implementation authority. Apple HIG is review guidance.

Official `vercel-react-native-skills`, `expo-animation`, `expo-design-system`,
`expo-native-ui`, `expo-router`, `expo-ui`, and `make-interfaces-feel-better`
SKILL.md folders are **not installed** in this checkout. Rules below are the
ones actually applied from the prior premium-experience skill read and from
Apple guidance already recorded in `IOS_APPLE_SKILL_AUDIT.md`.

Do not treat listing a skill name as compliance. Each row names a concrete rule
and the source that uses it.

---

SKILL
`vercel-react-native-skills`

RULE
Never `&&` a number into JSX. Strings only inside `Text`. No scroll Y in
`useState`. Animate transform/opacity only. Native tabs. Tabular numbers for
money.

SCREEN / COMPONENT
Home `frontend/app/(tabs)/index.tsx`
Tabs `frontend/app/(tabs)/_layout.tsx`
Net Royalties labels `frontend/src/lib/netRoyalties.ts`

IMPLEMENTATION
Missing royalties and spend render `"—"`, not `0 &&`. Hero and strip values use
`fontVariant: ["tabular-nums"]`. Tab bar stays native `expo-router` Tabs.
Scroll position is not stored. Net / Ads widgets are text-first, not artwork.

---

SKILL
`expo-animation`

RULE
Tab switches: no custom slide. Press feedback short. Reduced motion ships with
the animation. Do not animate icons because they represent automation.

SCREEN / COMPONENT
Tabs `_layout.tsx`
Welcome `frontend/app/auth/welcome.tsx`
Home BidBot card

IMPLEMENTATION
Tabs keep `animation: "none"`. Welcome lost the Zoom-in icon blob; remaining
enters respect `useReduceMotion()`. BidBot uses a static slider mark. No pulse,
glow, or “AI thinking” motion.

---

SKILL
`expo-design-system`

RULE
One theme. Repeated visual values are tokens. Screens do not invent 16/18/20/22.

SCREEN / COMPONENT
`frontend/src/lib/theme.ts` `dashboard`
`frontend/src/components/InteliAdsIcon.tsx`
Home `CardTitle`

IMPLEMENTATION
Added `dashboard.iconSm` 16, `iconMd` 18, `iconLg` 24, `iconEmpty` 28,
`iconStroke` 1.75. Icons and tab glyphs consume those tokens. Geometry rails
stay page inset 16 / section gap 16 / card padding 16 / radius 12.

---

SKILL
`expo-native-ui`

RULE
HIG spacing. Continuous corners on cards. 44pt tap targets. Semantic colors.
SF Symbols for system actions only.

SCREEN / COMPONENT
`DashboardSurface`
Home header chevrons / eye / refresh
Tab More glyph
`InteliAdsIcon`

IMPLEMENTATION
Product concepts use the custom family. Back/close/search/ellipsis/calendar/
chevron stay SF. Icon buttons keep `minHeight` / `minTap` 44 while the glyph
stays 16–24. Tab bar blur remains the system chrome, not card glass.

---

SKILL
`expo-router`

RULE
Native stack/tabs. Do not remount expensive trees on blur. No JS tab slide.

SCREEN / COMPONENT
`frontend/app/(tabs)/_layout.tsx`

IMPLEMENTATION
`freezeOnBlur: true`, `lazy: true`, `animation: "none"`. Custom product tab
icons replace generic megaphone / grid / location / book SF fills. More stays
`ellipsis.circle` because it is a system overflow action.

---

SKILL
`expo-ui`

RULE
Use the native segmented control. Do not rebuild period pickers in JS.

SCREEN / COMPONENT
Home Month/Week and Today/7D
Books sort segments

IMPLEMENTATION
Unchanged `IOSSegmentedControl`. Books sort key `net` is now labeled
`Net roy.` so the segment still fits four options without a custom picker.

---

SKILL
`make-interfaces-feel-better`

RULE
Typography before decoration. Optical hierarchy. No icon-in-a-blob default.
Press scale modest. No entrance replay on high-frequency surfaces.

SCREEN / COMPONENT
Home `CardTitle`
Action review
Welcome slides
Empty states

IMPLEMENTATION
`CardTitle` no longer wraps glyphs in a tinted rounded square. Review queue
uses an open attention/success mark. Welcome dropped the 72pt icon bubble.
Empty states that are product-owned (`books`, `bidBot`, `amazonAccounts`) use
one small custom mark + title + one line of copy.

---

SKILL
Apple `ios-development` / `ui-review` / `hig-checklist`

RULE
44pt targets. Semantic color is status, not decoration. Loading is native, not
a branded “AI” spinner. Dynamic Type must not let icons dominate money.

SCREEN / COMPONENT
Home financial widgets
Books row
Book Detail
`InteliAdsIcon`

IMPLEMENTATION
Hero is number → label → caption → freshness. Green/red on Net Royalties is
sign of money, not a badge rainbow. BidBot / Home loading stay
`ActivityIndicator` / `ScreenSpinner`. Icon sizes are fixed tokens; metric
type uses existing Dynamic Type styles.

---

SKILL
Apple `accessibility-audit`

RULE
Decorative icons hidden. Interactive icons labeled. VoiceOver names the money
domain, not “Net” or “Revenue”.

SCREEN / COMPONENT
`netRoyaltiesVoiceOver`
Home hero, Yesterday, Top books
Books list / Book Detail
`InteliAdsIcon`

IMPLEMENTATION
Decorative product icons set `accessibilityElementsHidden`. VoiceOver strings
say `KDP royalties`, `Amazon Ads spend`, `Net Royalties`, and optionally
`Amazon Ads sales`. Tab More keeps `tabBarAccessibilityLabel="More"`.

---

SKILL
Apple `navigation-patterns`

RULE
Tabs are peers. Physical device is feel authority. Do not invent a sixth tab.

SCREEN / COMPONENT
Tab bar
More hub

IMPLEMENTATION
Five tabs unchanged. Product identity is the glyph language, not a new
information architecture. More rows still push existing routes. BidBot More
row uses `slider.horizontal.3` (tool), not `cpu`.

---

## Skills intentionally not applied as installable packages

`find-skills` / Cursor marketplace skills were not installed mid-pass.
`humanizer` is a prose skill and was not used on product UI copy.

Apple `run-device` remains the physical certification gate. Source work does
not write visual-identity PASS.
