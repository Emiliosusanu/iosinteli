/**
 * Pure check mirrored from pricingBootstrap.bookshelfHtmlLooksSeeded
 * (avoid importing RN storage in node tests).
 */
import assert from "node:assert/strict";
import test from "node:test";

function bookshelfHtmlLooksSeeded(html) {
  const s = String(html || "");
  if (s.length < 400) return false;
  if (/ap\/signin|authportal|sign[\s_-]?in/i.test(s.slice(0, 2000))) return false;
  return /print-setup|dual-print-price-asin|title-setup\/paperback/i.test(s);
}

test("bookshelfHtmlLooksSeeded accepts print-setup shelf HTML", () => {
  const html = `${"x".repeat(500)}<a href="/en_US/print-setup/paperback/2RZKVQBNHD8/pricing">x</a>`;
  assert.equal(bookshelfHtmlLooksSeeded(html), true);
});

test("bookshelfHtmlLooksSeeded rejects sign-in pages", () => {
  const html = `${"x".repeat(500)}ap/signin authportal`;
  assert.equal(bookshelfHtmlLooksSeeded(html), false);
});

test("bookshelfHtmlLooksSeeded rejects tiny HTML", () => {
  assert.equal(bookshelfHtmlLooksSeeded("<html></html>"), false);
});
