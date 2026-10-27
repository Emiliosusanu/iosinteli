import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/kdp");
const keys = ['syncState', 'templates', 'deferredDays', 'replayCurrency'].map(k => 'inteliads.kdpHelper.' + k);
const accountKey = 'inteliads.kdpHelper.accountId';

function harness({ failRemove, retainedSession = false, nativeClear = true, failSecureDelete = false } = {}) {
  const values = new Map(keys.map(k => [k, 'old-account-data']));
  values.set(accountKey, 'old-account');
  let sessionPresent = true;
  let commits = 0;
  const storage = {
    async getItem(k, fallback) { return values.has(k) ? values.get(k) : fallback; },
    async setItem(k, v) { values.set(k, v); if (k === accountKey) commits++; return true; },
    async removeItem(k) { if (k === failRemove) return false; values.delete(k); return true; },
  };
  const secureStore = {
    async deleteItemAsync() { if (failSecureDelete) throw Error('Keychain unavailable'); if (!retainedSession) sessionPresent = false; },
    async getItemAsync() { return sessionPresent ? JSON.stringify({ cookies: 'fake-test-session' }) : null; },
  };
  function load(name) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    const requireMock = id => {
      if (id === '@/src/utils/storage') return { storage };
      if (id === './deferred.ts') return { normalizeDeferredDays: x => x };
      if (id === './planner.ts') return { createInitialSyncState: () => ({}), normalizeSyncState: x => x };
      if (id === './session.ts') return load('session.ts');
      if (id === 'expo-secure-store') return secureStore;
      if (id === 'react-native') return { Platform: { OS: 'ios' } };
      if (id === 'inteliads-native-sync') return { clearNativeAmazonKdpCookies: async () => nativeClear };
      if (id === './sessionContract.ts') return {};
      throw Error('Unexpected dependency: ' + id);
    };
    vm.runInNewContext(js, { module, exports: module.exports, require: requireMock, console });
    return module.exports;
  }
  return { helper: load('persist.ts'), session: load('session.ts'), values, commits: () => commits };
}

for (const key of keys) {
  test('refuses destination switch when removal fails: ' + key, async () => {
    const h = harness({ failRemove: key });
    await assert.rejects(h.helper.selectHelperAccountId('new-account'));
    assert.equal(h.values.get(accountKey), 'old-account');
    assert.equal(h.commits(), 0);
  });
}
test('refuses destination switch when Keychain deletion fails', async () => {
  const h = harness({ failSecureDelete: true });
  await assert.rejects(h.helper.selectHelperAccountId('new-account'));
  assert.equal(h.values.get(accountKey), 'old-account');
  assert.equal(h.commits(), 0);
});
test('refuses destination switch if deleted Keychain session remains readable', async () => {
  const h = harness({ retainedSession: true });
  await assert.rejects(h.helper.selectHelperAccountId('new-account'));
  assert.equal(h.values.get(accountKey), 'old-account');
});
test('refuses destination switch when native cookie cleanup fails', async () => {
  const h = harness({ nativeClear: false });
  await assert.rejects(h.helper.selectHelperAccountId('new-account'));
  assert.equal(h.values.get(accountKey), 'old-account');
});
test('commits new account only after every cleanup succeeds', async () => {
  const h = harness();
  await h.helper.selectHelperAccountId('new-account');
  assert.equal(h.values.get(accountKey), 'new-account');
  assert.equal(h.commits(), 1);
  for (const key of keys) assert.equal(h.values.has(key), false);
});
test('same account preserves saved state and session', async () => {
  const h = harness();
  await h.helper.selectHelperAccountId('old-account');
  assert.equal(h.commits(), 0);
  for (const key of keys) assert.equal(h.values.get(key), 'old-account-data');
});
