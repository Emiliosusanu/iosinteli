import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('wake lease restriction removes explicit client grants without changing dispatch state', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261103124654_restrict_kdp_wake_lease_execute.sql', import.meta.url), 'utf8');
  const statements = sql.replace(/--[^\n]*/g, '').split(';').map(value => value.trim().replace(/\s+/g, ' ')).filter(Boolean);
  assert.deepEqual(statements, [
    'revoke all on function public.claim_kdp_wake_dispatch(integer) from public, anon, authenticated',
    'grant execute on function public.claim_kdp_wake_dispatch(integer) to service_role',
  ]);
});
