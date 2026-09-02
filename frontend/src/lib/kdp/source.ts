/**
 * KDP royalty source selection (pure contract — no I/O, safe to unit-test).
 *
 * InteliAds imports KDP royalties/KENP/catalog with a Chrome extension that
 * scrapes kdpreports.amazon.com under the user's own KDP login. People who
 * cannot run the Chrome helper (iPhone-only sellers) can instead let this app
 * do the exact same import in an in-app WebView (the "iPhone helper").
 *
 * The setting is switchable in Settings > KDP data > Royalty source:
 *   - "extension"      → Chrome extension only (default; unchanged behavior).
 *   - "extension_ios"  → Chrome extension AND this iPhone. The iPhone helper
 *                        runs the same tables/logic as the extension:
 *                        today + yesterday every ~15 min, a 90-day onboarding
 *                        backfill on first enable, and a nightly last-30-day
 *                        correction pass. Never skip, never miss.
 *
 * Both writers target the SAME Supabase tables with the SAME conflict keys, so
 * enabling the iPhone helper alongside the extension is idempotent (upserts).
 *
 * The storage-backed getter/setter live in `./sourceStore` to keep this module
 * dependency-free.
 */

export type KdpRoyaltySource = "extension" | "extension_ios";

export const KDP_ROYALTY_SOURCE_KEY = "inteliads.kdpRoyaltySource";
export const DEFAULT_KDP_ROYALTY_SOURCE: KdpRoyaltySource = "extension";

export const KDP_ROYALTY_SOURCES: readonly KdpRoyaltySource[] = [
  "extension",
  "extension_ios",
] as const;

/** Short value shown on the Settings row (right side). */
export function kdpRoyaltySourceValueLabel(source: KdpRoyaltySource): string {
  return source === "extension_ios" ? "Chrome + iPhone" : "Chrome extension";
}

/** Title for the option row inside the picker. */
export function kdpRoyaltySourceOptionTitle(source: KdpRoyaltySource): string {
  return source === "extension_ios"
    ? "Chrome extension and iPhone"
    : "Chrome extension only";
}

/** One-line description for the option row inside the picker. */
export function kdpRoyaltySourceOptionSubtitle(source: KdpRoyaltySource): string {
  return source === "extension_ios"
    ? "This iPhone imports KDP the same way the Chrome helper does — today + yesterday every ~15 min, 90-day onboarding, nightly 30-day correction."
    : "KDP is imported only by the Chrome helper on your computer. This iPhone refreshes the already-imported royalties.";
}

export function isIosHelperEnabled(source: KdpRoyaltySource): boolean {
  return source === "extension_ios";
}

export function normalizeKdpRoyaltySource(raw: unknown): KdpRoyaltySource {
  return raw === "extension_ios" ? "extension_ios" : "extension";
}
