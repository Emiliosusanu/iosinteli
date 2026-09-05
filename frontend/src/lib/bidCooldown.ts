/**
 * Entity bid cooldown — web InteliAds parity.
 *
 * Any bid/state change stamped on the row (iOS, web, Amazon console, rules,
 * Bid Bot) starts a cooldown window from bid_last_modified_at /
 * rule_last_modified_at. Default length matches user_settings
 * entity_cooldown_hours (48h).
 */

export const DEFAULT_ENTITY_COOLDOWN_HOURS = 48;

/** Nest/user_settings `entity_cooldown_hours` — never invent a window. */
export function resolveEntityCooldownHours(raw: unknown): number {
  if (raw && typeof raw === "object" && raw !== null && "value" in raw) {
    return resolveEntityCooldownHours((raw as { value: unknown }).value);
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1 && n <= 168) return Math.round(n);
  return DEFAULT_ENTITY_COOLDOWN_HOURS;
}

export function pickEntityCooldownHours(settings: Record<string, unknown> | null | undefined): number {
  if (!settings) return DEFAULT_ENTITY_COOLDOWN_HOURS;
  return resolveEntityCooldownHours(
    settings.entity_cooldown_hours ?? settings.entityCooldownHours,
  );
}

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
  /** Campaign placement % provenance (Nest stamps alongside rule_last_modified_at). */
  placement_adj_last_modified_at?: string | null;
  placement_adj_change_source?: string | null;
  metrics_updated_at?: string | null;
};

/** Passed from cooldown chips — Nest forceCooldown only after Edit anyway. */
export type CooldownOverridePress = (opts?: { forceCooldown?: boolean }) => void;

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
  const candidates: Array<{ at: string; ms: number }> = [];
  for (const raw of [
    row.bid_last_modified_at,
    row.rule_last_modified_at,
    row.placement_adj_last_modified_at,
  ]) {
    const ms = parseMs(raw);
    if (ms != null && raw) candidates.push({ at: raw, ms });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.ms - a.ms);
  return candidates[0]!.at;
}

/**
 * Campaign settings cooldown (placement % and bidding strategy share Nest's
 * rule_last_modified_at / placement_adj stamp — same window as entity bids).
 */
export function getCampaignSettingsCooldown(
  row: EntityBidCooldownFields,
  cooldownHours: number = DEFAULT_ENTITY_COOLDOWN_HOURS,
  nowMs: number = Date.now(),
): EntityBidCooldownInfo {
  const source =
    (row.placement_adj_change_source || row.bid_change_source || "unknown") as BidChangeSource;
  return getEntityBidCooldown(
    {
      ...row,
      bid_change_source: source,
    },
    cooldownHours,
    nowMs,
  );
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
