import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { adGroupCreationNotice } from '../src/lib/adGroupCreationNotice.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../app/campaign/ad-group-create.tsx', import.meta.url), 'utf8');

function screenNotice(result, targeting, formatter) {
  const start = source.indexOf('      const notice = adGroupCreationNotice(');
  const fallback = source.indexOf('      Alert.alert(\n        "Ad group created",');
  const end = source.indexOf('\n    } catch (error)', start >= 0 ? start : fallback);
  assert.ok(end > 0);
  const context = {
    result, effectiveTargeting: targeting, adGroupCreationNotice: formatter,
    keywords: Array(9).fill({}), productTargets: Array(7).fill({}),
    Alert: { alert: (title, message) => { context.notice = { title, message }; } },
    router: {}, name: 'Private test draft',
  };
  const script = ts.transpileModule(source.slice(start >= 0 ? start : fallback, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(script, context);
  return context.notice;
}

test('a paused automatic ad group is never announced as live by the actual screen', () => {
  const notice = screenNotice({ adGroup: { id: 'group', state: 'paused' } }, 'auto', adGroupCreationNotice);
  assert.doesNotMatch(notice.message, /live|active|enabled/i);
  assert.match(notice.title, /paused/i);
});

test('missing confirmed counts never fall back to the requested target count', () => {
  for (const mode of ['keywords', 'products']) {
    const notice = screenNotice({ adGroup: { id: 'group', state: 'paused' } }, mode, adGroupCreationNotice);
    assert.doesNotMatch(notice.message, /Added [079]/);
    assert.match(notice.message, /not confirmed/i);
  }
});

test('only server-confirmed nonnegative integer counts are displayed, including zero', () => {
  for (const mode of ['keywords', 'products']) {
    for (const value of [0, 1, 4]) {
      const notice = adGroupCreationNotice({ adGroup: { state: 'PAUSED' }, keywordCount: value, productTargetCount: value }, mode);
      assert.match(notice.message, new RegExp(`Added ${value} `));
    }
    for (const value of [null, undefined, -1, 1.5, NaN, Infinity, '4']) {
      const notice = adGroupCreationNotice({ adGroup: { state: 'paused' }, keywordCount: value, productTargetCount: value }, mode);
      assert.match(notice.message, /count not confirmed/);
      assert.doesNotMatch(notice.message, /Added/);
    }
  }
});

test('enabled groups do not imply campaign delivery and unknown state is not paused', () => {
  const enabled = adGroupCreationNotice({ adGroup: { state: 'ENABLED' } }, 'auto');
  assert.equal(enabled.message, 'Ad group is enabled.');
  assert.doesNotMatch(enabled.message, /live|delivering|campaign active/i);
  for (const state of [undefined, null, '', 'unconfirmed', 'archived']) {
    const unknown = adGroupCreationNotice({ adGroup: { state } }, 'auto');
    assert.equal(unknown.title, 'Ad group created');
    assert.match(unknown.message, /Status not confirmed/);
  }
});
