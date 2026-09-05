/**
 * Entity bid cooldown — web InteliAds parity.
 *
 * Any bid/state change stamped on the row (iOS, web, Amazon console, rules,
 * Bid Bot) starts a cooldown window from bid_last_modified_at /
 * rule_last_modified_at. Default length matches user_settings
 * entity_cooldown_hours (48h).
 */

export const DEFAULT_ENTITY_COOLDOWN_HOURS = 48;

export type BidChangeSource =
  | "rule"
  | "bid_bot"
  | "manual"
  | "amazon_ads"
  | "ios"
  | "web"
  | "unknown"
  | string;

export type EntityBidCooldownFields = {
  bid_last_modified_at?: string | null;
  rule_last_modified_at?: string | null;
  bid_change_source?: string | null;
  metrics_updated_at?: string | null;
};

export type EntityBidCooldownInfo = {
  isInCooldown: boolean;
  startedAt: string | null;
  endsAt: string | null;
  remainingSeconds: number;
  source: BidChangeSource;
  sourceLabel: string;
};

export function bidChangeSourceLabel(source: string | null | undefined): string {
  const raw = String(source || "").toLowerCase().trim();
  if (!raw) return "a recent bid change";
  if (raw.includes("rule")) return "a rule";
  if (raw.includes("bid_bot") || raw.includes("bidbot") || raw.includes("bot")) return "Bid Bot";
  if (raw.includes("amazon")) return "Amazon Ads";
  if (raw.includes("ios") || raw.includes("iphone") || raw.includes("mobile")) return "this iPhone";
  if (raw.includes("web") || raw.includes("dashboard") || raw.includes("manual")) return "InteliAds";
  return "a recent bid change";
}

function parseMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : null;
}

/** Latest verified change timestamp that should start cooldown. */
export function resolveBidChangeAt(row: EntityBidCooldownFields): string | null {
  const bidMs = parseMs(row.bid_last_modified_at);
  const ruleMs = parseMs(row.rule_last_modified_at);
  if (bidMs == null && ruleMs == null) return null;
  if (bidMs == null) return row.rule_last_modified_at ?? null;
  if (ruleMs == null) return row.bid_last_modified_at ?? null;
  return bidMs >= ruleMs ? row.bid_last_modified_at! : row.rule_last_modified_at!;
}

export function getEntityBidCooldown(
  row: EntityBidCooldownFields,
  cooldownHours: number = DEFAULT_ENTITY_COOLDOWN_HOURS,
  nowMs: number = Date.now(),
): EntityBidCooldownInfo {
  const startedAt = resolveBidChangeAt(row);
  const source = (row.bid_change_source || "unknown") as BidChangeSource;
  const sourceLabel = bidChangeSourceLabel(row.bid_change_source);
  if (!startedAt) {
    return {
      isInCooldown: false,
      startedAt: null,
      endsAt: null,
      remainingSeconds: 0,
      source,
      sourceLabel,
    };
  }
  const startedMs = parseMs(startedAt);
  if (startedMs == null) {
    return {
      isInCooldown: false,
      startedAt: null,
      endsAt: null,
      remainingSeconds: 0,
      source,
      sourceLabel,
    };
  }
  const hours = Math.max(1, Number(cooldownHours) || DEFAULT_ENTITY_COOLDOWN_HOURS);
  const endsMs = startedMs + hours * 60 * 60 * 1000;
  const remainingSeconds = Math.max(0, Math.ceil((endsMs - nowMs) / 1000));
  return {
    isInCooldown: remainingSeconds > 0,
    startedAt: new Date(startedMs).toISOString(),
    endsAt: new Date(endsMs).toISOString(),
    remainingSeconds,
    source,
    sourceLabel,
  };
}

export function formatCooldownRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 48) return remM ? `${h}h ${remM}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

export function cooldownAlertMessage(info: EntityBidCooldownInfo): string {
  const left = formatCooldownRemaining(info.remainingSeconds);
  return `This bid was changed by ${info.sourceLabel}. Cooldown ends in ${left}. Editing now will reset the cooldown.`;
}
