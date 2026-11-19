import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql = readFileSync(new URL('../../supabase/migrations/20261103125447_harden_internal_data_api_boundaries.sql', import.meta.url), 'utf8');
test('internal table security patch enables RLS and removes client privileges without data writes', () => {
  const statements = sql.replace(/--[^\n]*/g, '').split(';').map(value => value.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const tables = ['_mwa_kdp_accounts','_mwa_purge_pids','_mwa_control_snap','seo_workflow_lease','seo_publication_counter','founding_reservations','founding_memberships','plan_limit_overrides'];
  for (const name of tables) assert.ok(statements.includes(`alter table public.${name} enable row level security`));
  const revoke = statements.find(value => value.endsWith('from public, anon, authenticated'));
  assert.ok(revoke);
  assert.deepEqual(revoke.slice('revoke all on table '.length).split(' from ')[0].split(', ').sort(), tables.map(name => 'public.' + name).sort());
  assert.equal(statements.length, 14);
  for (const value of statements) assert.match(value, /^(set local lock_timeout = '2s'|alter table .* enable row level security|alter view .* set \(security_invoker = true\)|revoke all on table .* from public, anon(?:, authenticated)?)$/);
});

test('metric views use invoker RLS and retain authenticated/service readers', () => {
  for (const name of ['user_keyword_metrics','user_search_term_metrics','user_campaign_metrics']) {
    assert.ok(sql.includes(`alter view public.${name} set (security_invoker = true);`));
  }
  const viewRevoke = sql.slice(sql.lastIndexOf('revoke all on table'));
  assert.match(viewRevoke, /from public, anon;/);
  assert.doesNotMatch(viewRevoke, /authenticated|service_role/);
  assert.doesNotMatch(sql, /create policy|disable row level security|security_invoker = false/i);
});
