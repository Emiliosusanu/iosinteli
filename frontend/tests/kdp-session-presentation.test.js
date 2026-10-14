import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kdpSessionPresentation } from '../src/lib/kdp/sessionPresentation.ts';

test('a saved cookie candidate never displays background ready without verification', () => {
  assert.deepEqual(kdpSessionPresentation({loggedIn:false,savedSession:true,sessionChecked:true}),
    {label:'Saved session · check required',verified:false});
});
test('Amazon sign-in or step-up is displayed even when reports cookies are retained', () => {
  for (const url of ['https://www.amazon.com/ap/signin?openid=example','https://www.amazon.co.uk/ap/mfa','https://www.amazon.com/ap/cvf']) {
    assert.deepEqual(kdpSessionPresentation({loggedIn:true,savedSession:true,sessionChecked:true,currentUrl:url}),
      {label:'Amazon sign-in required',verified:false});
  }
});
test('only a live logged-in state is presented as signed in', () => {
  assert.deepEqual(kdpSessionPresentation({loggedIn:true,savedSession:true,sessionChecked:true,currentUrl:'https://kdpreports.amazon.com/royalties'}),
    {label:'Signed in',verified:true});
  assert.equal(kdpSessionPresentation({loggedIn:false,savedSession:false,sessionChecked:false}).verified,false);
});
