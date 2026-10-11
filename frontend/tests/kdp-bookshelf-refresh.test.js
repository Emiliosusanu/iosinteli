import test from 'node:test';
import assert from 'node:assert/strict';
import { bookshelfPageEvidence } from '../src/lib/kdp/vendor/kdp-bookshelf-discovery.js';
import { emptyPricingCatalog as emptyCatalog, acceptCatalogPage as acceptPage } from '../src/lib/kdp/pricingCatalog.ts';

const shell = content => `<html><a href="/signout">Sign out</a><div id="refreshedbookshelftable">${content}</div></html>`;
const card = (id, format) => `<div class="bookshelf-itemset-metadata-column" id="zme-indie-bookshelf-dual-itemset-itemset-metadata-title-${id}"></div><div id="zme-indie-bookshelf-dual-${format}-price-asin-${id}"></div>`;
test('ebook and hardcover-only pages advance discovery without discarding later paperbacks', () => {
  let state = emptyCatalog();
  const firstRows = [{ kdpBookId: 'PRINT00001', printAsin: 'B0PRINT001', printStatus: 'live' }];
  state = acceptPage(state, 1, firstRows, 1, bookshelfPageEvidence(shell(card('PRINT00001','print')),firstRows));
  const digital = bookshelfPageEvidence(shell(card('DIGITAL001','digital')));
  state = acceptPage(state, 2, [], 2, digital);
  assert.equal(state.complete, false); assert.equal(state.page, 3); assert.equal(state.rows.length, 1);
  const hardcover = bookshelfPageEvidence(shell(card('HARD000001','hardcover')));
  state = acceptPage(state, 3, [], 3, hardcover);
  assert.equal(state.complete, false); assert.equal(state.page, 4);
  const lastRows = [{ kdpBookId:'PRINT00002',printAsin:'B0PRINT002',printStatus:'live' }];
  state = acceptPage(state,4,lastRows,4,bookshelfPageEvidence(shell(card('PRINT00002','print')),lastRows));
  const done = acceptPage(state,5,[],5,bookshelfPageEvidence(shell('')));
  assert.equal(done.complete,true); assert.equal(done.rows.length,2);
});
test('partial header, login, unparsed cards and ignored non-print pages never seal discovery', () => {
  const digital=bookshelfPageEvidence(shell(card('DIGITAL001','digital')));
  const first=acceptPage(emptyCatalog(),1,[],1,digital);
  const repeated=acceptPage(first,2,[],2,digital);
  assert.equal(repeated.complete,false); assert.equal(repeated.stalled,true);
  for(const html of ['Bookshelf',shell('').replace('</html>',''),shell('<div class="bookshelf-itemset-metadata-column"></div>'),'<html><title>Amazon Sign In</title><div id="refreshedbookshelftable"></div></html>']) {
    const evidence=bookshelfPageEvidence(html);
    assert.equal(evidence.terminal,false);
    assert.throws(()=>acceptPage(first,2,[],2,evidence),/unverified/);
    assert.equal(first.page,2);
  }
});

test('Amazon Tabela pages cover 700 titles and resume without accepting a missing row', async () => {
  const { bookshelfRefreshRequest, bookshelfRefreshEvidence } = await import('../src/lib/kdp/vendor/kdp-bookshelf-discovery.js');
  const fragment = (page, count = 700, omit = false) => {
    const ids = Array.from({length: Math.min(50, Math.max(0,count-(page-1)*50))},(_,i)=>`TITLE${String((page-1)*50+i).padStart(5,'0')}`);
    if (omit) ids.pop();
    return `<div id="mt-response-status">SUCCESS</div><div id="recordsPerPage">50</div><div id="recordCount">${count}</div><div id="currentPage">${page}</div><div id="tableName">refreshedbookshelftable</div><div id="itemRecords"><script type="text/html">${ids.map(id=>card(id,'digital')).join('')}</script></div><div id="refreshMode">TABLE</div>`;
  };
  const request = bookshelfRefreshRequest(3,12000);
  assert.equal(request.method,'POST'); assert.equal(JSON.parse(request.body).pageNumber,3);
  assert.equal(JSON.parse(request.body).clientState.viewVal,'ALL');
  let state = emptyCatalog();
  for(let page=1;page<=14;page++) {
    if (page===8) {
      state=JSON.parse(JSON.stringify(state));
      assert.throws(()=>bookshelfRefreshEvidence(fragment(page,700,true),page),/coverage incomplete/);
      assert.equal(state.page,8);
    }
    state=acceptPage(state,page,[],page,bookshelfRefreshEvidence(fragment(page),page));
  }
  assert.equal(state.complete,true); assert.equal(state.discoveryKeys.length,700);
  assert.throws(()=>bookshelfRefreshEvidence(fragment(13),14),/incomplete/);
  const changed=acceptPage(acceptPage(emptyCatalog(),1,[],1,bookshelfRefreshEvidence(fragment(1),1)),2,[],2,bookshelfRefreshEvidence(fragment(2,701),2));
  assert.equal(changed.stalled,true); assert.equal(changed.complete,false);
});
