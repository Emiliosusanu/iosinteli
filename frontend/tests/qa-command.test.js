import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseQaCommand,
  stashPendingQaFilters,
  takePendingQaFilters,
} from "../src/lib/qaCommand.ts";

test("parseQaCommand keeps targetsAdvanced ranges", () => {
  const cmd = parseQaCommand(
    JSON.stringify({
      id: "tgt-adv-acos",
      route: "/(tabs)/targeting",
      targetsAdvanced: { acosMin: 20, acosMax: 80, bidMin: 0.2 },
    }),
  );
  assert.ok(cmd);
  assert.equal(cmd.id, "tgt-adv-acos");
  assert.deepEqual(cmd.targetsAdvanced, { acosMin: 20, acosMax: 80, bidMin: 0.2 });
});

test("stash/take pending QA filters preserves targetsAdvanced", () => {
  stashPendingQaFilters({
    id: "tgt-adv-bid",
    targetsSegment: "keywords",
    targetsAdvanced: { bidMin: 0.2, bidMax: 2 },
  });
  const next = takePendingQaFilters();
  assert.ok(next);
  assert.equal(next.targetsSegment, "keywords");
  assert.deepEqual(next.targetsAdvanced, { bidMin: 0.2, bidMax: 2 });
  assert.equal(takePendingQaFilters(), null);
});
