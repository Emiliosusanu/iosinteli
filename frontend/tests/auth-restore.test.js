const { test } = require("node:test");
const assert = require("node:assert/strict");
const { userLookupProvesSessionInvalid } = require("../src/lib/authRestore.ts");

test("transient user lookup failures preserve a persisted mobile session", () => {
  assert.equal(userLookupProvesSessionInvalid({ status: 500 }, false), false);
  assert.equal(userLookupProvesSessionInvalid({ status: 504 }, false), false);
  assert.equal(userLookupProvesSessionInvalid(new TypeError("Network request failed"), false), false);
});

test("explicitly invalid sessions are cleared", () => {
  assert.equal(userLookupProvesSessionInvalid({ status: 401 }, false), true);
  assert.equal(userLookupProvesSessionInvalid({ code: "bad_jwt", status: 400 }, false), true);
  assert.equal(userLookupProvesSessionInvalid({ code: "user_not_found", status: 404 }, false), true);
  assert.equal(userLookupProvesSessionInvalid(null, false), true);
});

test("a returned user always verifies the session", () => {
  assert.equal(userLookupProvesSessionInvalid({ status: 500 }, true), false);
});
