import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isHomeQueryTimeout, HOME_QUERY_TIMEOUT_MESSAGE} from '../src/lib/queryTimeout.ts';

test('server statement timeout objects are recognized without claiming offline or empty results',()=>{
  assert.equal(isHomeQueryTimeout({code:'57014',message:'canceling statement due to statement timeout'}),true);
  assert.equal(isHomeQueryTimeout(new Error(HOME_QUERY_TIMEOUT_MESSAGE)),true);
  for(const error of [null,undefined,{code:'42501'},{status:401},new TypeError('Network request failed')])assert.equal(isHomeQueryTimeout(error),false);
  const source=readFileSync(new URL('../app/(tabs)/targeting.tsx',import.meta.url),'utf8');
  assert.match(source,/systemImage=\{isHomeQueryTimeout\(activeQuery.error\) \? "clock"/);
  assert.match(source,/Retry keeps your filters/);
  assert.doesNotMatch(source,/Try Week instead of Month/);
});
