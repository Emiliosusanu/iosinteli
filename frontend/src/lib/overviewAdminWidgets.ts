import { fetchAggregatedCampaigns, mapNestKeyword } from './dashboardApi';
import { nestApiJson } from './rulesApi';
import { normalizeEntityState } from './campaigns';
import type { AdGroup, Keyword } from './types';

type Scope = { filterUserId: string; start: string; end: string; limit?: number; signal?: AbortSignal };
type LiveParents = { campaign_state: string; ad_group_state?: string };
const active = (value: unknown) => normalizeEntityState(value as string | null) === 'enabled';
const chunks = <T,>(rows: T[], size: number): T[][] => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
const query = (values: Record<string, unknown>) => new URLSearchParams(Object.entries(values)
  .filter(([, value]) => value != null).map(([key, value]) => [key, String(value)])).toString();

/** Customer-preview reads use the authorized Nest API, never the admin's RLS identity. */
async function activeGroups(profiles: string[], scope: Scope): Promise<Array<AdGroup & LiveParents>> {
  if (!profiles.length) return [];
  const campaigns = await fetchAggregatedCampaigns({ profileIds: profiles, filterUserId: scope.filterUserId,
    startDate: scope.start, endDate: scope.end, state: 'enabled', signal: scope.signal });
  const campaignIds = new Set(campaigns.filter(c => active(c.state)).map(c => c.id));
  const out = new Map<string, AdGroup & LiveParents>();
  for (const ids of chunks([...campaignIds], 80)) {
    const seen = new Set<string>();
    for (let page = 1; ; page++) {
      if (page > 100) throw new Error('Active ad group catalog is incomplete');
      const raw = await nestApiJson<{ data?: Array<Record<string, any>>; total?: number; hasNextPage?: boolean }>(
        `/ad-groups?${query({ filterUserId: scope.filterUserId, campaignIds: ids.join(','), state: 'enabled', campaignStatus: 'enabled',
          startDate: scope.start, endDate: scope.end, per_page: 100, page, sortBy: 'total_spend', sortOrder: 'desc' })}`,
        { method: 'GET', signal: scope.signal }, "Couldn't load active ad groups.");
      if (!Array.isArray(raw.data)) throw new Error('Active ad group response unavailable');
      let added = 0;
      for (const r of raw.data) {
        const id = String(r.id ?? r.adGroupId ?? ''), campaignId = String(r.campaignId ?? r.campaign_id ?? '');
        if (id && !seen.has(id)) { seen.add(id); added++; }
        if (!id || !campaignIds.has(campaignId) || !ids.includes(campaignId) || !active(r.state)) continue;
        const profile = String(r.amazonProfileId ?? r.amazon_profile_id ?? '');
        if (profile && !profiles.includes(profile)) continue;
        out.set(id, { ...r, id, campaign_id: campaignId, amazon_profile_id: profile || null,
          name: r.name ?? null, default_bid: r.defaultBid ?? r.default_bid ?? null,
          targeting_type: r.targetingType ?? r.targeting_type ?? null,
          created_at: String(r.createdAt ?? r.created_at ?? ''), updated_at: String(r.updatedAt ?? r.updated_at ?? ''),
          campaign_state: 'enabled' } as AdGroup & LiveParents);
      }
      const more = raw.hasNextPage ?? (raw.total != null ? page * 100 < raw.total : raw.data.length === 100);
      if (!more) break;
      if (!added) throw new Error('Active ad group pagination stalled');
    }
  }
  return [...out.values()];
}

export async function fetchAdminOverviewActiveAdGroups(profiles: string[], scope: Scope) {
  return (await activeGroups(profiles, scope)).sort((a, b) => Number(b.total_spend ?? 0) - Number(a.total_spend ?? 0))
    .slice(0, scope.limit ?? 80).map(group => ({ ...group, keyword_count: 0, product_target_count: 0,
      auto_target_count: 0, is_auto: String(group.targeting_type).toLowerCase() === 'auto' }));
}

export async function fetchAdminOverviewActiveKeywords(profiles: string[], scope: Scope): Promise<Array<Keyword & LiveParents>> {
  const groups = new Map((await activeGroups(profiles, scope)).map(group => [group.id, group]));
  if (!groups.size) return [];
  const out = new Map<string, Keyword & LiveParents>(), limit = scope.limit ?? 80;
  // Each profile is ranked independently before the final merge. Filtering paused
  // parents can require another page even when the first server page is full.
  for (const profileId of profiles) {
    const rows: Array<Keyword & LiveParents> = [], seen = new Set<string>();
    for (let page = 1; rows.length < limit; page++) {
      if (page > 100) throw new Error('Active keyword catalog is incomplete');
      const raw = await nestApiJson<{ data?: unknown[]; total?: number; hasNextPage?: boolean }>(
        `/keywords?${query({ filterUserId: scope.filterUserId, amazonProfileId: profileId, campaignStatus: 'enabled', status: 'enabled',
          startDate: scope.start, endDate: scope.end, per_page: 200, page, sortBy: 'total_spend', sortOrder: 'desc', includeEnrichments: 'false' })}`,
        { method: 'GET', signal: scope.signal }, "Couldn't load active keywords.");
      if (!Array.isArray(raw.data)) throw new Error('Active keyword response unavailable');
      let added = 0;
      for (const value of raw.data) {
        const row = mapNestKeyword(value), group = groups.get(row.ad_group_id ?? '');
        if (!row.id || seen.has(row.id)) continue;
        seen.add(row.id); added++;
        if (active(row.status) && group && group.campaign_id === row.campaign_id
          && (!row.amazon_profile_id || row.amazon_profile_id === profileId)) {
          rows.push({ ...row, amazon_profile_id: profileId, campaign_state: 'enabled', ad_group_state: 'enabled' });
        }
      }
      const more = raw.hasNextPage ?? (raw.total != null ? page * 200 < raw.total : raw.data.length === 200);
      if (!more) break;
      if (!added) throw new Error('Active keyword pagination stalled');
    }
    for (const row of rows.slice(0, limit)) out.set(row.id, row);
  }
  return [...out.values()].sort((a, b) => Number(b.total_spend ?? 0) - Number(a.total_spend ?? 0)).slice(0, limit);
}
