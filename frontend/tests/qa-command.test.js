import { test } from "node:test";
import assert from "node:assert/strict";

import {
  QA_ACK_KEY,
  QA_COMMAND_KEY,
  parseQaCommand,
  stashPendingQaFilters,
  takePendingQaFilters,
} from "../src/lib/qaCommand.ts";

test("physical QA command and acknowledgement keys stay distinct", () => {
  assert.equal(QA_COMMAND_KEY, "inteliads.qa.command");
  assert.equal(QA_ACK_KEY, "inteliads.qa.ack");
  assert.notEqual(QA_COMMAND_KEY, QA_ACK_KEY);
});

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
