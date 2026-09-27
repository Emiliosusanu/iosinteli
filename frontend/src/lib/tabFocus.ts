/** Root tab route names in navigator order. */
export const TAB_NAMES = ["index", "campaigns", "targeting", "products", "more"] as const;
export type TabName = (typeof TAB_NAMES)[number];

function isTabName(value: string): value is TabName {
  return (TAB_NAMES as readonly string[]).includes(value);
}

/**
 * Resolve which root tab owns the current URL.
 * Prefer pathname/segments over state.index so nested stacks and stale
 * tab state cannot leave the sliding pill on the wrong page.
 */
export function resolveFocusedTabName(
  pathname: string,
  segments: readonly string[],
  routes: { name: string }[],
  stateIndex: number,
): string {
  const path = pathname.toLowerCase();
  if (path.includes("/campaign")) return "campaigns";
  if (
    path.includes("/keyword") ||
    path.includes("/target") ||
    path.includes("/search-term") ||
    path.includes("/targeting")
  ) {
    return "targeting";
  }
  if (path.includes("/product") || path.includes("/products")) return "products";
  if (path.includes("/more")) return "more";
  if (
    path === "/" ||
    path.endsWith("/(tabs)") ||
    path.endsWith("/(tabs)/") ||
    path.includes("/index") ||
    /(^|\/)\(tabs\)$/.test(path)
  ) {
    return "index";
  }

  // Router segments can briefly contain the previously focused tab during a
  // transition. Use the deepest tab segment, never the first stale one.
  for (const seg of [...segments].reverse()) {
    if (isTabName(seg)) return seg;
  }

  const fallback = routes[stateIndex]?.name;
  return fallback && isTabName(fallback) ? fallback : "index";
}
