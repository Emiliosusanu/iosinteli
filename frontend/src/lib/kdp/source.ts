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
 *   - "extension_ios"  → This iPhone is an autonomous KDP collector. Chrome
 *                        may also remain installed, but it is not required.
 *                        The iPhone helper runs the same tables/logic:
 *                        today + yesterday every ~15 min, a 90-day onboarding
 *                        backfill only when web history is missing, and a
 *                        nightly last-30-day correction pass. Never skip,
 *                        never miss. Background ticks replay Keychain sessions
 *                        (Royaltix-style) without needing the WebView attached.
 *
 * Both writers target the SAME atomic server replacement with the SAME conflict
 * keys, so leaving Chrome enabled alongside the iPhone remains idempotent.
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
  return source === "extension_ios" ? "iPhone helper" : "Chrome extension";
}

/** Title for the option row inside the picker. */
export function kdpRoyaltySourceOptionTitle(source: KdpRoyaltySource): string {
  return source === "extension_ios"
    ? "iPhone helper"
    : "Chrome only";
}

/** One-line description for the option row inside the picker. */
export function kdpRoyaltySourceOptionSubtitle(source: KdpRoyaltySource): string {
  return source === "extension_ios"
    ? "Imports on this iPhone; Chrome can stay off"
    : "Imports on Chrome only";
}

export function isIosHelperEnabled(source: KdpRoyaltySource): boolean {
  return source === "extension_ios";
}

export function normalizeKdpRoyaltySource(raw: unknown): KdpRoyaltySource {
  return raw === "extension_ios" ? "extension_ios" : "extension";
}
