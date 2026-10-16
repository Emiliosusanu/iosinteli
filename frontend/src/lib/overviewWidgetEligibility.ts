import { normalizeEntityState } from './campaigns.ts';

export type OverviewEntityKind = 'campaign' | 'adGroup' | 'keyword';
type Row = { state?: string | null; status?: string | null; campaign_state?: string | null; ad_group_state?: string | null };

/** Recommendations must describe entities that can actually deliver now.
 * Search terms are historical observations and deliberately do not use this gate. */
export function activeOverviewRows<T extends Row>(rows: readonly T[], kind: OverviewEntityKind): T[] {
  return rows.filter(row => normalizeEntityState(kind === 'keyword' ? row.status : row.state) === 'enabled'
    && (kind === 'campaign' || normalizeEntityState(row.campaign_state) === 'enabled')
    && (kind !== 'keyword' || normalizeEntityState(row.ad_group_state) === 'enabled'));
}
