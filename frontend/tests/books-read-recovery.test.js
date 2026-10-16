import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRetryBooksRead, bookRetailRefetchInterval } from '../src/lib/booksReadRecovery.ts';
test('a timed-out read recovers with two bounded retries', () => {
 for (const error of [new Error('HOME_QUERY_TIMEOUT'), new Error('Network request failed'), {status:503}, {code:'57014'}]) {
  assert.equal(shouldRetryBooksRead(0,error),true); assert.equal(shouldRetryBooksRead(1,error),true); assert.equal(shouldRetryBooksRead(2,error),false);
 }
});
test('access denial, missing ownership, cancellation and unknown failures never auto-retry', () => {
 for (const error of [{status:401},{status:402},{status:403},{status:404},{name:'AbortError',status:503},new Error('unexpected parser error')]) assert.equal(shouldRetryBooksRead(0,error),false);
});

test('partial reads and pending background refresh get bounded foreground follow-up reads', () => {
 assert.equal(bookRetailRefetchInterval({state:{data:{failedRequests:1},dataUpdateCount:1}}),5000);
 assert.equal(bookRetailRefetchInterval({state:{data:{failedRequests:1},dataUpdateCount:3}}),false);
 assert.equal(bookRetailRefetchInterval({state:{data:{pendingRequests:1},dataUpdateCount:29}}),2000);
 assert.equal(bookRetailRefetchInterval({state:{data:{pendingRequests:1},dataUpdateCount:30}}),false);
 assert.equal(bookRetailRefetchInterval({state:{data:{pendingRequests:0,failedRequests:0}}}),false);
});
