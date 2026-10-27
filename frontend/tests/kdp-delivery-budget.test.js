import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { taskDeadline } from '../src/lib/kdp/backgroundBudget.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/lib/notifications.ts', import.meta.url), 'utf8');
const start = source.indexOf('async function runBudgetedKdpTask(');
const end = source.indexOf('defineLaunchSafeTask(INTELIADS_BACKGROUND_TASK', start);
const runnerSource = ts.transpileModule(source.slice(start, end).replace(
  /import\("([^"]+)"\)/g, (_, name) => `imports[${JSON.stringify(name)}]()`,
), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('short and processing native KDP deliveries finish after capture without unbounded auxiliary writes or detached reads', async () => {
  for (const mode of ['recent', 'processing']) {
    const events = [];
    const deliveredDeadline = Date.now() + 8_000;
    const imports = {
      './kdp/importer': async () => ({ runKdpIosHelperTick: async (reason, opts) => {
        events.push({ reason, opts });
        assert.equal(opts.deadlineAtMs, deliveredDeadline);
        assert.equal(opts.wakeMode, mode);
      } }),
      './kdp/backgroundWake': async () => ({ resolveLockedPhoneKdpWakeMode: async () => mode }),
      'inteliads-native-sync': async () => ({ getNativeWakeDeadline: async () => deliveredDeadline }),
      './kdp/backgroundBudget': async () => ({ taskDeadline }),
    };
    const guardedImports = new Proxy(imports, { get(target, name) {
      assert.ok(name in target, `unbounded auxiliary import: ${String(name)}`);
      return target[name];
    } });
    const run = new Function('imports', 'BackgroundTask', 'devWarn', `${runnerSource}; return runBudgetedKdpTask;`)(
      guardedImports, { BackgroundTaskResult: { Success: 'success' } }, (_message, error) => { throw error; },
    );
    assert.equal(await run('background'), 'success');
    assert.equal(events.length, 1);
    assert.equal(events[0].reason, mode === 'processing' ? 'processing' : 'background');
  }
});
