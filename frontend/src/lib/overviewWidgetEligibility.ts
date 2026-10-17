import { normalizeEntityState } from './campaigns.ts';

export type OverviewEntityKind = 'campaign' | 'adGroup' | 'keyword' | 'searchTerm';
type Row = { state?: string | null; status?: string | null; campaign_state?: string | null; ad_group_state?: string | null };

/** Recommendations describe live entities; observations require both live parents. */
export function activeOverviewRows<T extends Row>(rows: readonly T[], kind: OverviewEntityKind): T[] {
  return rows.filter(row => (kind === 'searchTerm' || normalizeEntityState(kind === 'keyword' ? row.status : row.state) === 'enabled')
    && (kind === 'campaign' || normalizeEntityState(row.campaign_state) === 'enabled')
    && ((kind !== 'keyword' && kind !== 'searchTerm') || normalizeEntityState(row.ad_group_state) === 'enabled'));
}
