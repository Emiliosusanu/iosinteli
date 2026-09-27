import { formatCurrency } from "./format.ts";

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
  | "bid_engine"
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
  /** Last confirmed bid before the cooldown-starting write. */
  bid_previous_value?: number | null;
  bid?: number | null;
  bid_amount?: number | null;
  default_bid?: number | null;
  /** Campaign placement % provenance — Nest JSONB map per slot, or legacy ISO string. */
  placement_adj_last_modified_at?: string | Record<string, string> | null;
  placement_adj_change_source?: string | Record<string, string> | null;
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
  /** Short Countdown chip tag (Rule / Bot / Internal / External). */
  sourceTag: string;
  sourceLabel: string;
  previousBid: number | null;
  currentBid: number | null;
};

/** Cent-level tolerance — Amazon bids are $0.01. */
export const BID_DRIFT_EPSILON = 0.005;

/**
 * Countdown source tags — web InteliAds parity.
 * rule → Rule | bot → Bot | manual/ios/web → Internal | amazon_ads → External
 */
export function bidChangeSourceTag(source: string | null | undefined): string {
  const raw = String(source || "").toLowerCase().trim();
  if (!raw) return "Unknown";
  if (raw.includes("rule")) return "Rule";
  if (raw.includes("bid_bot") || raw.includes("bidbot") || raw.includes("bid_engine") || raw === "bot") {
    return "Bot";
  }
  if (raw.includes("amazon")) return "External";
  if (
    raw.includes("ios") ||
    raw.includes("iphone") ||
    raw.includes("mobile") ||
    raw.includes("web") ||
    raw.includes("dashboard") ||
    raw.includes("manual")
  ) {
    return "Internal";
  }
  return "Unknown";
}

export function bidChangeSourceLabel(source: string | null | undefined): string {
  const tag = bidChangeSourceTag(source);
  switch (tag) {
    case "Rule":
      return "a rule";
    case "Bot":
      return "Bid Bot";
    case "External":
      return "Amazon Ads (external)";
    case "Internal": {
      const raw = String(source || "").toLowerCase().trim();
      if (raw.includes("ios") || raw.includes("iphone") || raw.includes("mobile")) {
        return "this iPhone";
      }
      return "InteliAds";
    }
    default:
      return "a recent bid change";
  }
}

function parseBidNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function readCurrentBid(row: EntityBidCooldownFields): number | null {
  return parseBidNumber(row.bid ?? row.bid_amount ?? row.default_bid);
}

export function readPreviousBid(row: EntityBidCooldownFields): number | null {
  return parseBidNumber(row.bid_previous_value);
}

/**
 * Web `reconcileLatestBidChangeWithLiveBid` parity: if live bid drifted past
 * the stamped previous→current write without a fresh Nest stamp matching live,
 * reclassify as external Amazon (up or down). Never treat our own rule/bot/
 * manual stamp as external when live still matches the stamped new bid.
 */
export function reconcileBidChangeSourceWithLiveBid(
  row: EntityBidCooldownFields,
): EntityBidCooldownFields {
  const live = readCurrentBid(row);
  const previous = readPreviousBid(row);
  const source = String(row.bid_change_source || "").trim();
  if (live == null || previous == null || !source) return row;
  // Stamped "new" is not stored separately — Nest keeps previous + live.
  // Drift detection: when Nest sync already stamped amazon_ads, keep it.
  // When live moved away from previous without matching a fresh internal write
  // window, amazon sync owns the stamp (Nest sets amazon_ads). Client only
  // reclassifies when live differs from previous and source is missing/unknown
  // OR when previous→live delta exists under a stale non-amazon stamp whose
  // "new" was previous (impossible) — use Nest stamp trust for known writers.
  const knownInternal =
    /^(rule|bid_bot|bid_engine|manual|ios|web)$/i.test(source) ||
    source.toLowerCase().includes("rule") ||
    source.toLowerCase().includes("bot") ||
    source.toLowerCase().includes("manual") ||
    source.toLowerCase().includes("ios") ||
    source.toLowerCase().includes("web");
  const knownExternal = source.toLowerCase().includes("amazon");
  if (knownExternal || knownInternal) return row;
  if (Math.abs(live - previous) < BID_DRIFT_EPSILON) return row;
  return {
    ...row,
    bid_change_source: "amazon_ads",
  };
}

export function formatBidChangePhrase(
  previous: number | null,
  current: number | null,
  currency?: string | null,
): string | null {
  if (previous == null || current == null || previous === current) return null;
  const from = formatCurrency(previous, currency);
  const to = formatCurrency(current, currency);
  const direction = current < previous ? "decreased" : "increased";
  return `from ${from} to ${to} (${direction})`;
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
    // Legacy string stamp only — per-slot maps are read via getPlacementAdjCooldown(field).
    typeof row.placement_adj_last_modified_at === "string" ? row.placement_adj_last_modified_at : null,
  ]) {
    const ms = parseMs(raw);
    if (ms != null && raw) candidates.push({ at: raw, ms });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.ms - a.ms);
  return candidates[0]!.at;
}

export type PlacementAdjSlot = "top_of_search" | "product_pages" | "rest_of_search";

function readPlacementAdjSlotStamp(
  raw: string | Record<string, string> | null | undefined,
  field?: PlacementAdjSlot | null,
): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  if (!field) {
    // No slot requested — use the newest stamp across slots (bulk / campaign-level).
    let newest: string | null = null;
    let newestMs = -1;
    for (const value of Object.values(raw)) {
      const ms = parseMs(value);
      if (ms != null && ms > newestMs) {
        newestMs = ms;
        newest = String(value);
      }
    }
    return newest;
  }
  const slot = raw[field];
  return typeof slot === "string" ? slot : null;
}

function readPlacementAdjSlotSource(
  raw: string | Record<string, string> | null | undefined,
  field?: PlacementAdjSlot | null,
): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  if (!field) return null;
  const slot = raw[field];
  return typeof slot === "string" ? slot : null;
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

/** Strategy edits are independent from placement-percentage edits. */
export function getCampaignStrategyCooldown(
  row: EntityBidCooldownFields,
  cooldownHours: number = DEFAULT_ENTITY_COOLDOWN_HOURS,
  nowMs: number = Date.now(),
): EntityBidCooldownInfo {
  return getEntityBidCooldown(
    {
      ...row,
      placement_adj_last_modified_at: null,
      placement_adj_change_source: null,
    },
    cooldownHours,
    nowMs,
  );
}

/** Placement % cooldown — only the edited slot’s stamp (Nest JSONB per key). */
export function getPlacementAdjCooldown(
  row: EntityBidCooldownFields,
  cooldownHours: number = DEFAULT_ENTITY_COOLDOWN_HOURS,
  nowMs: number = Date.now(),
  field?: PlacementAdjSlot | null,
): EntityBidCooldownInfo {
  const stamp = readPlacementAdjSlotStamp(row.placement_adj_last_modified_at, field);
  const sourceRaw = readPlacementAdjSlotSource(row.placement_adj_change_source, field);
  const source = (sourceRaw || "unknown") as BidChangeSource;
  return getEntityBidCooldown(
    {
      placement_adj_last_modified_at: stamp,
      placement_adj_change_source: sourceRaw,
      bid_last_modified_at: null,
      rule_last_modified_at: null,
      bid_change_source: source,
      bid_previous_value: null,
      bid: null,
      bid_amount: null,
      default_bid: null,
    },
    cooldownHours,
    nowMs,
  );
}

function cooldownIdentity(
  row: EntityBidCooldownFields,
  source: BidChangeSource,
  sourceLabel: string,
  extra: Partial<EntityBidCooldownInfo> = {},
): EntityBidCooldownInfo {
  return {
    isInCooldown: false,
    startedAt: null,
    endsAt: null,
    remainingSeconds: 0,
    source,
    sourceTag: bidChangeSourceTag(source),
    sourceLabel,
    previousBid: readPreviousBid(row),
    currentBid: readCurrentBid(row),
    ...extra,
  };
}

export function getEntityBidCooldown(
  row: EntityBidCooldownFields,
  cooldownHours: number = DEFAULT_ENTITY_COOLDOWN_HOURS,
  nowMs: number = Date.now(),
): EntityBidCooldownInfo {
  const reconciled = reconcileBidChangeSourceWithLiveBid(row);
  const startedAt = resolveBidChangeAt(reconciled);
  const source = (reconciled.bid_change_source || "unknown") as BidChangeSource;
  const sourceLabel = bidChangeSourceLabel(reconciled.bid_change_source);
  if (!startedAt) {
    return cooldownIdentity(reconciled, source, sourceLabel);
  }
  const startedMs = parseMs(startedAt);
  if (startedMs == null) {
    return cooldownIdentity(reconciled, source, sourceLabel);
  }
  const hours = Math.max(1, Number(cooldownHours) || DEFAULT_ENTITY_COOLDOWN_HOURS);
  const endsMs = startedMs + hours * 60 * 60 * 1000;
  const remainingSeconds = Math.max(0, Math.ceil((endsMs - nowMs) / 1000));
  return cooldownIdentity(reconciled, source, sourceLabel, {
    isInCooldown: remainingSeconds > 0,
    startedAt: new Date(startedMs).toISOString(),
    endsAt: new Date(endsMs).toISOString(),
    remainingSeconds,
  });
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

export function cooldownAlertMessage(
  info: EntityBidCooldownInfo,
  currency?: string | null,
): string {
  const left = formatCooldownRemaining(info.remainingSeconds);
  const change = formatBidChangePhrase(info.previousBid, info.currentBid, currency);
  if (change) {
    return `This bid was changed by ${info.sourceLabel} ${change}. Cooldown ends in ${left}. Editing now will reset the cooldown.`;
  }
  return `This bid was changed by ${info.sourceLabel}. Cooldown ends in ${left}. Editing now will reset the cooldown.`;
}
