import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('backend-resolved user RPCs cannot be called with a client-supplied foreign scope', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261103125949_restrict_backend_owned_rpc_execute.sql', import.meta.url), 'utf8');
  const statements = sql.replace(/--[^\n]*/g, '').split(';').map(value => value.trim().replace(/\s+/g, ' ')).filter(Boolean);
  assert.equal(statements.length,2);
  assert.ok(statements[0].startsWith('revoke all on function '));
  assert.ok(statements[0].endsWith(' from public, anon, authenticated'));
  assert.ok(statements[1].startsWith('grant execute on function '));
  assert.ok(statements[1].endsWith(' to service_role'));
  const expected = ['get_search_terms_with_metrics_page','get_targeting_metric_report_coverage','page_keywords_negative_status','page_negative_keywords','page_negative_product_targets','page_product_targets_negative_status','reserve_founding_membership_slot'].sort();
  for (const statement of statements) {
    const names = [...statement.matchAll(/public\.([a-z_]+)\(/g)].map(match => match[1]).sort();
    assert.deepEqual(names,expected);
  }
  assert.doesNotMatch(sql,/create|replace|drop|alter|insert|update|delete|mobile_targeting_page_v1|claim_kdp_wake_dispatch/i);
});
