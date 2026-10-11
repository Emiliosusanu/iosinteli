import type { KdpActivityKind } from "./activity.ts";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]"],
  [/\b(access[_-]?token|refresh[_-]?token|authorization|cookie|password)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]"],
];

export function redactKdpDiagnosticText(value: unknown, maxLength = 1_900): string {
  let text = String(value ?? "");
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text.slice(0, maxLength);
}

export function classifyKdpDiagnosticEvent(
  message: string,
  kind: KdpActivityKind,
): string {
  const normalized = String(message || "").toLowerCase();
  if (kind === "error") return "ios.kdp.error";
  if (normalized.includes("protected") || normalized.includes("overwrite")) {
    return "ios.kdp.protection";
  }
  if (normalized.includes("pricing") || normalized.includes("price")) {
    return normalized.includes("retry") || normalized.includes("pending")
      ? "ios.kdp.pricing.retry"
      : "ios.kdp.pricing";
  }
  if (kind === "nightly" || normalized.includes("backfill")) return "ios.kdp.backfill";
  if (kind === "onboarding") return "ios.kdp.onboarding";
  if (kind === "currency") return "ios.kdp.currency";
  if (kind === "steady" || normalized.includes("sync")) return "ios.kdp.sync";
  return "ios.kdp.activity";
}

export function levelForKdpDiagnostic(kind: KdpActivityKind): "error" | "info" {
  return kind === "error" ? "error" : "info";
}
