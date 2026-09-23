/**
 * Format ASINs encoded on KDP work / group keys for Create-from-book.
 * Keys look like: DIGITAL=<kindle>:PRINT=<paperback>:: or HARDCOVER= / AUDIO=
 */

import { profileEnabled } from "./accountsUi.ts";

export type BookFormatKind = "kindle" | "paperback" | "hardcover" | "audiobook";

export type BookFormatOption = {
  kind: BookFormatKind;
  label: string;
  asin: string;
};

const FORMAT_SPECS: Array<{ kind: BookFormatKind; label: string; re: RegExp }> = [
  { kind: "kindle", label: "Kindle", re: /DIGITAL=([A-Z0-9]{8,})/i },
  { kind: "paperback", label: "Paperback", re: /PRINT=([A-Z0-9]{8,})/i },
  { kind: "hardcover", label: "Hardcover", re: /HARDCOVER=([A-Z0-9]{8,})/i },
  { kind: "audiobook", label: "Audiobook", re: /AUDIO(?:BOOK)?=([A-Z0-9]{8,})/i },
];

export function formatsFromWorkKey(workKey: string | null | undefined): BookFormatOption[] {
  const key = String(workKey ?? "").trim();
  if (!key) return [];
  const seen = new Set<string>();
  const out: BookFormatOption[] = [];
  for (const spec of FORMAT_SPECS) {
    const match = key.match(spec.re);
    const asin = String(match?.[1] ?? "")
      .trim()
      .toUpperCase();
    if (!asin || seen.has(asin)) continue;
    seen.add(asin);
    out.push({ kind: spec.kind, label: spec.label, asin });
  }
  return out;
}

/** SP create prefers paperback when the work encodes PRINT=. */
export function defaultCreateFormatAsin(formats: readonly BookFormatOption[]): string | null {
  const paperback = formats.find((row) => row.kind === "paperback");
  if (paperback) return paperback.asin;
  return formats[0]?.asin ?? null;
}

/**
 * Format chips on Create campaign. Audiobook is never Sponsored-Products creatable.
 * Kindle / Hardcover stay visible so the exclusive segment can switch; advertised
 * ASIN still resolves to PRINT when present (see advertisedAsinForCreateFormat).
 */
export function createFlowFormatOptions(
  formats: readonly BookFormatOption[],
): BookFormatOption[] {
  return formats.filter((row) => row.kind !== "audiobook");
}

/**
 * Exclusive format chip → ASIN to search / advertise.
 * Kindle (and audiobook if ever shown) remap to PRINT when encoded — SP ads
 * print. Hardcover prefers PRINT when both exist so search does not empty.
 * The chip UI itself keeps the tapped format selected via selectedFormatAsin.
 */
export function advertisedAsinForCreateFormat(
  selected: BookFormatOption | undefined | null,
  formats: readonly BookFormatOption[],
  workKey?: string | null,
): string | null {
  if (!selected) return defaultCreateFormatAsin(formats);
  if (selected.kind === "kindle" || selected.kind === "audiobook") {
    const print =
      formats.find((row) => row.kind === "paperback")?.asin ??
      String(workKey ?? "")
        .toUpperCase()
        .match(/PRINT=([A-Z0-9]{8,})/)?.[1] ??
      null;
    return print || selected.asin;
  }
  if (selected.kind === "hardcover") {
    const print = formats.find((row) => row.kind === "paperback")?.asin;
    return print || selected.asin;
  }
  return selected.asin;
}

export function preferredEnabledProfileId(
  profiles: ReadonlyArray<{
    id: string;
    profile_id?: string | null;
    is_enabled?: boolean | null;
    country_code?: string | null;
  }>,
  preferredCountry?: string | null,
  /** Nest book-linked Ads profile ids — prefer these over first US match. */
  preferredAdsProfileIds?: readonly string[] | null,
): string | null {
  const enabled = profiles.filter((p) => profileEnabled(p));
  if (!enabled.length) return null;
  const preferred = new Set(
    (preferredAdsProfileIds ?? [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean),
  );
  if (preferred.size) {
    const linked = enabled.find(
      (p) => preferred.has(p.id) || preferred.has(String(p.profile_id ?? "")),
    );
    if (linked) return linked.id;
  }
  const want = String(preferredCountry || "")
    .trim()
    .toUpperCase();
  if (want) {
    const match = enabled.find(
      (p) => String(p.country_code || "").trim().toUpperCase() === want,
    );
    if (match) return match.id;
  }
  return enabled[0]?.id ?? null;
}
