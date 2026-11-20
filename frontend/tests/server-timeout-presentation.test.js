import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isHomeQueryTimeout, HOME_QUERY_TIMEOUT_MESSAGE} from '../src/lib/queryTimeout.ts';

test('server statement timeout objects are recognized without claiming offline or empty results',()=>{
  assert.equal(isHomeQueryTimeout({code:'57014',message:'canceling statement due to statement timeout'}),true);
  assert.equal(isHomeQueryTimeout(new Error(HOME_QUERY_TIMEOUT_MESSAGE)),true);
  assert.equal(isHomeQueryTimeout({status:408,message:'The read timed out'}),true);
  for(const error of [null,undefined,{code:'42501'},{status:401},new TypeError('Network request failed')])assert.equal(isHomeQueryTimeout(error),false);
  const source=readFileSync(new URL('../app/(tabs)/targeting.tsx',import.meta.url),'utf8');
  assert.match(source,/systemImage=\{isHomeQueryTimeout\(activeQuery.error\) \? "clock"/);
  assert.match(source,/TERMINAL_READ_TIMEOUT_SUBTITLE/);
  assert.match(readFileSync(new URL('../src/lib/loadErrorCopy.ts', import.meta.url), 'utf8'), /This read timed out and was not sent again/);
  assert.match(source,/onRetry=/);
  const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(home, /retryOnceOnStatementTimeout/);
  const queries = readFileSync(new URL('../src/lib/queries.ts', import.meta.url), 'utf8');
  assert.match(queries, /rethrowTerminalRead\(error\);\s*noteNestKeywordSortFailure/);
  assert.match(queries, /rethrowTerminalRead\(error\);[\s\S]{0,120}Nest product targets failed/);
  assert.equal((queries.match(/rethrowTerminalRead\(error\)/g) || []).length, 3);
  assert.doesNotMatch(source,/Try Week instead of Month/);
});
