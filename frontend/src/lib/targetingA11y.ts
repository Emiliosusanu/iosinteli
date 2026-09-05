// Presentation-only VoiceOver copy for targeting rows and details. Does not mutate Ads.

export function matchTypeSpoken(match?: string | null): string {
  const key = String(match ?? "").toLowerCase();
  if (key === "exact") return "Exact keyword";
  if (key === "phrase") return "Phrase keyword";
  if (key === "broad") return "Broad keyword";
  if (!key) return "Keyword";
  return `${match} keyword`;
}

export function enabledSpoken(enabled: boolean | null | undefined): string | null {
  if (enabled == null) return null;
  return enabled ? "Enabled" : "Paused";
}

export function targetingSpeech(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(". ");
}
