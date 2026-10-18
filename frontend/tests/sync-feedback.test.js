import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSyncFeedback } from '../src/lib/syncFeedback.ts';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const idle = { fetching: false, failed: false, updatedAt: 100, received: true };
const begin = () => nextSyncFeedback(null, 'US/week', { ...idle, fetching: true }, true);

test('only an observed successful same-context read produces green', () => {
  assert.equal(nextSyncFeedback(null, 'US/week', idle, true).phase, 'idle');
  const start = begin();
  assert.equal(start.phase, 'updating');
  assert.equal(nextSyncFeedback(start, 'US/week', { ...idle, updatedAt: 200 }, true).phase, 'success');
  for (const updatedAt of [100, 0, NaN, Infinity]) {
    assert.equal(nextSyncFeedback(start, 'US/week', { ...idle, updatedAt }, true).phase, 'idle');
  }
  assert.equal(nextSyncFeedback(start, 'US/week', { ...idle, failed: true, updatedAt: 200 }, true).phase, 'idle');
  assert.equal(nextSyncFeedback(start, 'US/week', { ...idle, received: false, updatedAt: 200 }, true).phase, 'idle', 'Cache hydration alone is not a received read');
});

test('period, market, customer, page, logout and visibility transitions cannot inherit success', () => {
  for (const key of ['All/week', 'US/month', 'other-user', 'other-customer', 'other-page', 'logout']) {
    assert.equal(nextSyncFeedback(begin(), key, { ...idle, updatedAt: 200 }, true).phase, 'idle');
  }
  const hidden = nextSyncFeedback(begin(), 'US/week', { ...idle, updatedAt: 200 }, false);
  assert.equal(hidden.phase, 'idle');
  assert.equal(nextSyncFeedback(hidden, 'US/week', { ...idle, updatedAt: 200 }, true).phase, 'idle');
});

test('intermediate query updates preserve the baseline until completion', () => {
  const halfway = nextSyncFeedback(begin(), 'US/week', { ...idle, fetching: true, updatedAt: 200 }, true);
  assert.equal(halfway.baseline, 100);
  assert.equal(nextSyncFeedback(halfway, 'US/week', { ...idle, updatedAt: 200 }, true).phase, 'success');
});

function mountFrame(reduced = false) {
  const hooks = [], pending = [], timers = new Map();
  let cursor = 0, listener, removed = false, repeats = 0, cancels = 0;
  const ref = value => { const index = cursor++; return hooks[index] ??= { current: value }; };
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: ref,
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], value => { hooks[index] = value; }];
    },
    useEffect(effect, deps) {
      const index = cursor++, previous = hooks[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        pending.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: effect() }; });
      }
    },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/SyncGlowFrame.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports,
    setTimeout: callback => { const id = Symbol(); timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    require(name) {
      if (name === 'react') return { ...React, default: React };
      if (name === 'react-native') return { View: 'View', StyleSheet: { create: x => x, absoluteFillObject: { position: 'absolute' } }, AppState: {
        currentState: 'active', addEventListener: (_, callback) => { listener = callback; return { remove: () => { removed = true; } }; },
      } };
      if (name === 'react-native-reanimated') return {
        default: { View: 'AnimatedView' }, Easing: { ease: 0, inOut: x => x },
        useSharedValue: value => { const r = ref(null); return r.current ??= { value, get() { return this.value; }, set(n) { this.value = n; } }; },
        useAnimatedStyle: f => f(), cancelAnimation: () => { cancels++; },
        withTiming: n => n, withRepeat: n => { repeats++; return n; },
      };
      if (name.endsWith('/syncFeedback')) return { nextSyncFeedback };
      if (name.endsWith('/motion')) return { motion: { updateEmphasis: 100 } };
      if (name.endsWith('/theme')) return { useReduceMotion: () => reduced, useTheme: () => ({ colors: { tone_good: 'green', tone_primary: 'blue' } }) };
      throw Error(name);
    },
  });
  const props = { read: idle, contextKey: 'US/week', radius: 8, children: 'content' };
  const render = changes => {
    Object.assign(props, changes);
    cursor = 0;
    exports.SyncGlowFrame(props);
    while (pending.length) pending.shift()();
    cursor = 0;
    return exports.SyncGlowFrame(props).children[1];
  };
  return { render, timers, background: () => listener('background'),
    stats: () => ({ repeats, cancels, removed }),
    unmount: () => hooks.forEach(h => h?.cleanup?.()),
  };
}

test('actual frame fully disappears, cleans timers, and cancels background/unmounted animation', () => {
  const frame = mountFrame();
  const initial = frame.render({});
  assert.equal(initial.props.style[2].opacity, 0);
  assert.equal(initial.props.pointerEvents, 'none');
  assert.equal(initial.props.accessibilityElementsHidden, true);
  frame.render({ read: { ...idle, fetching: true } });
  const success = frame.render({ read: { ...idle, updatedAt: 200 } });
  assert.equal(success.props.style[1].borderColor, 'green');
  assert.ok(success.props.style[2].opacity > 0);
  for (const callback of frame.timers.values()) callback();
  assert.equal(frame.render({}).props.style[2].opacity, 0);
  frame.render({ read: { ...idle, fetching: true, updatedAt: 200 } });
  frame.background();
  assert.equal(frame.render({}).props.style[2].opacity, 0);
  frame.unmount();
  assert.equal(frame.stats().removed, true);
  assert.ok(frame.stats().cancels > 0);
});

test('actual frame never shows green on failure/cancellation/context change and respects Reduce Motion', () => {
  const frame = mountFrame(true);
  frame.render({ read: { ...idle, fetching: true } });
  const cancelled = frame.render({ read: idle });
  assert.equal(cancelled.props.style[2].opacity, 0);
  frame.render({ read: { ...idle, fetching: true } });
  assert.equal(frame.render({ read: { ...idle, failed: true, updatedAt: 300 } }).props.style[2].opacity, 0);
  frame.render({ read: { ...idle, fetching: true } });
  assert.equal(frame.render({ contextKey: 'All/month', read: { ...idle, updatedAt: 400 } }).props.style[2].opacity, 0);
  assert.equal(frame.stats().repeats, 0);
  frame.unmount();
  assert.equal(frame.timers.size, 0);
});

test('actual header ready effect uses the same evidence and suppresses offscreen/context/failure success', () => {
  const source = readFileSync(new URL('../src/components/OverviewHeaderV3.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const previousRead = useRef');
  const block = source.slice(start, source.indexOf('  const syncNeedsLabel', start));
  const compiled = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let cleanup, green = false;
  const previous = { current: null }, timers = new Map();
  const context = {
    useRef: () => previous, useEffect: f => { cleanup?.(); cleanup = f(); }, nextSyncFeedback,
    setSyncReadyVisible: value => { green = value; },
    setTimeout: f => { const id = Symbol(); timers.set(id, f); return id; }, clearTimeout: id => timers.delete(id),
    syncReadContextKey: 'US/week', syncFailedOrStale: false, reduceMotion: false,
    showRefreshGlow: false, syncVisible: true, foreground: true, expandedInteractive: true, syncRead: idle,
  };
  const update = changes => { Object.assign(context, changes); vm.runInNewContext(compiled, { ...context }); return green; };
  assert.equal(update({}), false);
  update({ showRefreshGlow: true });
  assert.equal(update({ showRefreshGlow: false, syncRead: { ...idle, updatedAt: 200 } }), true);
  assert.equal(timers.size, 1);
  update({ showRefreshGlow: true });
  assert.equal(timers.size, 0);
  assert.equal(update({ showRefreshGlow: false, syncReadContextKey: 'All/month', syncRead: { ...idle, updatedAt: 300 } }), false);
  update({ showRefreshGlow: true });
  assert.equal(update({ showRefreshGlow: false, syncFailedOrStale: true, syncRead: { ...idle, updatedAt: 400 } }), false);
  update({ showRefreshGlow: true, syncFailedOrStale: false });
  assert.equal(update({ showRefreshGlow: false, foreground: false, syncRead: { ...idle, updatedAt: 500 } }), false);
  cleanup?.();
});
