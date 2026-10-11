import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("../src/components/TopBar.tsx", import.meta.url), "utf8");

test("Phase E filter sheet: Status then Sort/Performance before Books; ranges disclosed", () => {
  const sheetIdx = targeting.indexOf("function FilterSheetFields");
  assert.ok(sheetIdx > 0);
  const sheet = targeting.slice(sheetIdx);
  const statusIdx = sheet.indexOf("targeting-state-filter");
  const sortIdx = sheet.search(/\n\s*Sort\n\s*<\//);
  const perfIdx = sheet.search(/\n\s*Performance\n\s*<\//);
  const bookIdx = sheet.search(/\n\s*Book\n\s*<\//);
  const rangesIdx = sheet.indexOf("targeting-ranges-toggle");
  assert.ok(statusIdx > 0, "Status Active/Paused/All in filter sheet");
  assert.ok(sortIdx > statusIdx, "Sort after Status");
  assert.ok(perfIdx > sortIdx, "Performance after Sort");
  assert.ok(bookIdx > perfIdx, "Book after Performance");
  assert.ok(rangesIdx > bookIdx, "Ranges toggle after Book");
  assert.match(sheet, /FilterCheckRow/);
  assert.match(sheet, /size="xs"/);
  assert.doesNotMatch(sheet, /styles\.chipWrap/);
  assert.doesNotMatch(sheet, /styles\.filterChip/);
});

test("Phase E date sheet uses en-dash; profiles sheet is name-primary", () => {
  assert.match(topBar, /\{preset\.range\.start\} – \{preset\.range\.end\}/);
  assert.doesNotMatch(topBar, /\{\"->\"\}/);
  assert.doesNotMatch(topBar, /ProfileCoverStrip/);
  assert.match(topBar, /presentationStyle=\{Platform\.OS === "ios" \? "pageSheet"/);
});
