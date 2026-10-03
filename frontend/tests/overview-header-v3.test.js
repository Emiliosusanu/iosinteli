import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const header = readFileSync(new URL("../src/components/OverviewHeaderV3.tsx", import.meta.url), "utf8");
const marketPill = readFileSync(new URL("../src/components/MarketPill.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/lib/theme.ts", import.meta.url), "utf8");

test("OverviewHeaderV3 is a compact two-row control bar", () => {
  assert.match(header, /testID="home-header-v3"/);
  assert.match(header, /GlassPanel/);
  assert.match(header, /styles\.row1/);
  assert.match(header, /styles\.row2/);
  assert.match(header, /PeriodToggle/);
  assert.doesNotMatch(header, /IOSSegmentedControl/);
});

test("OverviewHeaderV3 keeps period and profile accessibility", () => {
  assert.match(header, /accessibilityRole="tablist"/);
  assert.match(header, /accessibilityRole="tab"/);
  assert.match(header, /"home-period"/);
  assert.match(header, /home-period-month/);
  assert.match(header, /home-period-week/);
  assert.match(header, /home-period-day/);
  assert.match(header, /home-period-compact/);
  assert.match(header, /layout\.minTap/);
  assert.match(header, /Profiles,/);
  assert.match(header, /Currency,/);
  assert.match(header, /Previous period/);
  assert.match(header, /Next period/);
});

test("OverviewHeaderV3 surfaces honest period transition states", () => {
  assert.match(header, /periodLoading/);
  assert.match(header, /periodRefreshing/);
  assert.match(header, /Loading…/);
  assert.match(header, /Updating…/);
  assert.match(header, /useReduceMotion/);
});

test("OverviewHeaderV3 uses lateral stadium glow instead of wide Refreshing pill", () => {
  assert.match(header, /StadiumLateralGlow/);
  assert.match(header, /home-header-refresh-glow/);
  assert.match(header, /showRefreshGlow/);
  assert.match(header, /home-sync-loading/);
  assert.match(header, /home-sync-ready/);
  assert.match(header, /suppressRefreshingCaption/);
  assert.match(header, /expo-linear-gradient/);
  // Quiet primary edge shadow, not neon wash / warning-success animation.
  assert.match(header, /duration: 2100/);
  assert.match(header, /lateralGlowCore/);
  assert.match(header, /lateralGlowBloom/);
  assert.match(header, /home-header-glow-primary/);
  assert.match(header, /home-header-glow-edge-left/);
  assert.match(header, /width: 3/);
  assert.match(header, /top: 32/);
  assert.match(header, /\[0\.08, 0\.22\]/);
  assert.doesNotMatch(header, /STADIUM_SMOKE_BANDS/);
  assert.doesNotMatch(header, /lateralGlowWash/);
  assert.doesNotMatch(header, /\$\{mid\}E6/);
  assert.doesNotMatch(header, /shadowOpacity:\s*0\.85/);
  // Busy sync must not paint the orange "Refreshing"/"Syncing" label chip.
  assert.match(header, /showRefreshGlow \|\| syncReadyVisible \? \(/);
  assert.doesNotMatch(
    header.slice(header.indexOf("showRefreshGlow || syncReadyVisible ? ("), header.indexOf(") : (", header.indexOf("showRefreshGlow || syncReadyVisible ? (")) + 40),
    /\{syncCompact\}/,
  );
});

test("OverviewHeaderV3 moves from primary loading glow to brief green ready state", () => {
  assert.match(header, /color=\{t\.colors\.tone_primary\}/);
  assert.match(header, /successColor=\{t\.colors\.tone_good\}/);
  assert.match(header, /failedOrStale/);
  assert.match(header, /home-header-glow-primary/);
  assert.match(header, /home-header-glow-ready/);
  assert.match(header, /setTimeout\(\(\) => setSyncReadyVisible\(false\), reduceMotion \? 700 : 1150\)/);
  assert.match(header, /StadiumSideGlow/);
  assert.match(header, /EASE_GLOW/);
  assert.doesNotMatch(header, /warningColor|greenMix|home-header-glow-amber/);
  assert.match(header, /hexWithAlpha\(color, 0\.48\)/);
  assert.doesNotMatch(header, /hexWithAlpha\(color, 1\)/);
});

test("Home wires OverviewHeaderV3 instead of legacy header stack", () => {
  assert.match(home, /OverviewHeaderV3/);
  assert.match(home, /periodLoading:/);
  assert.match(home, /periodRefreshing/);
  assert.match(home, /\{\.\.\.headerNavProps\}/);
  assert.doesNotMatch(home, /OverviewTopRow/);
  assert.doesNotMatch(home, /OverviewDateNav/);
  assert.doesNotMatch(home, /testID="home-period"[\s\S]*IOSSegmentedControl/);
  assert.doesNotMatch(home, /home-money-scope-hint/);
  assert.doesNotMatch(home, /mixedMarketplaceMoneyHint/);
});

test("OverviewHeaderV3 expanded shell matches build 209 stadium chrome", () => {
  assert.match(header, /useOverview209Chrome/);
  assert.match(header, /background_secondary/);
  assert.match(header, /shadow\.card/);
  assert.match(header, /shadow\.stadium/);
  assert.match(header, /borderRadius:\s*999/);
  assert.match(header, /maxWidth:\s*"100%"/);
  assert.match(header, /fontSize: compact \? 14 : 17/);
  assert.match(header, /Updating…/);
  assert.match(header, /chrome_selected/);
  assert.match(header, /sun\.max/);
  assert.match(header, /calendar\.badge\.clock/);
  // Scheme-synced shell + stadium rail tokens (black Month pill retained).
  assert.match(header, /chrome\.colors\.chrome_rail/);
  assert.match(header, /chrome\.colors\.background_secondary/);
});

test("OverviewHeaderV3 market pill uses separated circular flag discs", () => {
  assert.match(header, /from "@\/src\/components\/MarketPill"/);
  assert.match(header, /<MarketPill/);
  assert.match(header, /home-market-pill/);
  assert.match(header, /marketCountries/);
  assert.match(header, /hasMarketPill \? \(/);
  // Glass + separated discs live in shared MarketPill.
  assert.match(marketPill, /MarketFlagStack/);
  assert.match(marketPill, /multi-country-flags/);
  assert.match(marketPill, /marketFlagDisc/);
  assert.match(marketPill, /MARKET_FLAG_GAP/);
  assert.match(marketPill, /marginLeft: index > 0 \? MARKET_FLAG_GAP/);
  assert.match(marketPill, /zIndex: index \+ 1/);
  assert.match(marketPill, /borderRadius: MARKET_FLAG_SIZE \/ 2/);
  assert.match(marketPill, /market_pill_flag_rim/);
  assert.match(marketPill, /overflow:\s*"hidden"/);
  assert.match(marketPill, /formatMarketPillLabel/);
  assert.match(marketPill, /allowFontScaling=\{false\}/);
  assert.match(marketPill, /blurIntensity/);
  assert.match(marketPill, /systemChromeMaterialLight/);
  assert.match(marketPill, /market_pill_wash/);
  assert.match(marketPill, /market_pill_stroke/);
  assert.doesNotMatch(marketPill, /tint="dark"/);
  assert.match(marketPill, /chevron\.down/);
  // Currency merged into pill — no separate currency chip when markets present.
  const marketStart = header.indexOf("hasMarketPill ? (");
  const marketElse = header.indexOf(") : (", marketStart);
  const marketBranch = header.slice(marketStart, marketElse);
  assert.doesNotMatch(marketBranch, /styles\.currencyChip/);
  assert.doesNotMatch(marketBranch, /building\.2/);
  assert.match(marketBranch, /MarketPill/);
  // Fallback (no countries) still keeps a currency chip.
  assert.match(header.slice(marketElse), /styles\.currencyChip/);
  assert.match(home, /marketCountries=\{marketCountries\}/);
  assert.match(home, /multiCountryCodes/);
});

test("OverviewHeaderV3 lets users select all markets or one detected marketplace", () => {
  assert.match(header, /selectedMarketCountry/);
  assert.match(header, /onMarketSelectionChange/);
  assert.match(header, /styles\.marketSheet/);
  assert.match(header, /All markets/);
  assert.match(header, /onMarketSelectionChange\(country\)/);
  assert.match(home, /selectedMarketCountry=\{selectedAdsMarket\}/);
  assert.match(home, /onMarketSelectionChange=\{setSelectedAdsMarket\}/);
});

test("OverviewHeaderV3 keeps currency a11y when markets absent", () => {
  assert.match(header, /Currency,/);
  assert.match(header, /Profiles,/);
  assert.match(header, /building\.2/);
});

test("Overview collapsing header uses Reanimated scroll shared value", () => {
  assert.match(header, /useOverviewHeaderScroll/);
  assert.match(header, /OverviewHeaderCompactSticky/);
  assert.match(header, /useAnimatedScrollHandler/);
  assert.match(header, /Math\.max\(scrollY\.get\(\), 0\)/);
  assert.match(header, /HANDOFF_END/);
  assert.doesNotMatch(header, /useState\(.*scrollY/);
  assert.match(home, /Animated\.ScrollView/);
  assert.match(home, /OverviewHeaderCompactSticky/);
  assert.match(home, /useOverviewHeaderScroll/);
  assert.doesNotMatch(home, /stickyHeaderIndices/);
});

test("Collapse choreography is position-based with compact sticky handoff", () => {
  assert.match(header, /PHASE1_END/);
  assert.match(header, /PHASE2_END/);
  assert.match(header, /testID="home-header-compact"/);
  assert.match(header, /accessibilityElementsHidden/);
  assert.match(header, /COMPACT_ROW/);
  assert.match(header, /useTwoRowCompact/);
  assert.match(header, /compactEnterOpacity/);
  assert.match(header, /stickySurfaceOpacity/);
  assert.match(header, /compactTighten/);
  assert.match(header, /chrome_sticky_rgb/);
  assert.match(header, /chrome_hairline_rgb/);
  assert.match(header, /stickyRgbSV/);
  assert.match(header, /stickyWashScrollSV/);
});

test("Compact sticky chrome is full-bleed under the status bar", () => {
  assert.match(header, /home-header-compact/);
  assert.match(header, /COMPACT_CORNER/);
  assert.match(header, /borderBottomLeftRadius/);
  assert.match(header, /const topInset = Math\.max\(insets\.top, 4\);/);
  assert.match(header, /position: "absolute"/);
  assert.match(header, /top: 0/);
  assert.doesNotMatch(header, /compactRoot:\s*\{[^}]*bottom:\s*0/);
});

test("Compact sticky mounts outside GestureDetector on Overview", () => {
  assert.match(home, /OverviewHeaderCompactSticky/);
  assert.match(home, /GestureDetector/);
  const stickyAt = home.indexOf("<OverviewHeaderCompactSticky");
  const gestureAt = home.indexOf("<GestureDetector gesture={periodSwipe}>");
  assert.ok(stickyAt >= 0 && gestureAt >= 0 && stickyAt < gestureAt);
});

test("theme exposes header V3 tokens", () => {
  assert.match(theme, /headerShellRadius/);
  assert.match(theme, /headerRowGap/);
  assert.match(theme, /headerControl/);
  assert.match(theme, /density/);
  assert.match(theme, /statusChip/);
  assert.match(theme, /chrome_rail/);
  assert.match(theme, /chrome_selected/);
  assert.match(theme, /chrome_rail_stroke/);
  assert.match(theme, /chrome_sticky_rgb/);
  assert.match(theme, /chrome_hairline_rgb/);
  assert.match(theme, /stadium:/);
  // Dock follows scheme: solid white / #141417; market pill keeps frost washes.
  assert.match(theme, /tabbar_background: "#FFFFFF"/);
  assert.match(theme, /tabbar_background: "#141417"/);
  assert.match(theme, /market_pill_wash:/);
  assert.match(theme, /tabbar_selected:/);
  assert.match(theme, /tabbar_inactive:/);
  assert.match(theme, /tabbar_selected: "rgba\(0, 122, 255/);
  assert.match(theme, /ThemePreference/);
});

test("Overview header shell is scheme-synced elevated card with stadium chrome", () => {
  assert.match(header, /strength="card"/);
  const shellBlock = header.slice(
    header.indexOf('testID="home-header-v3"'),
    header.indexOf("contentStyle={styles.shellInner}"),
  );
  assert.match(shellBlock, /chrome\.colors\.background_secondary/);
  assert.match(shellBlock, /chrome\.shadow\.card/);
  assert.match(shellBlock, /Scheme-synced elevated shell/);
});

test("theme Overview 209 chrome follows active light/dark scheme", () => {
  assert.match(theme, /useOverview209Chrome/);
  assert.match(theme, /useTheme\(\)/);
  assert.doesNotMatch(
    theme.slice(theme.indexOf("export function useOverview209Chrome"), theme.indexOf("export function useReduceMotion")),
    /palette\.light/,
  );
  assert.match(theme, /chrome_rail: "#2C2C30"/);
  assert.match(theme, /chrome_selected: "#000000"/);
});
