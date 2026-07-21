import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractTasksToCreate } from "../src/modules/visits/report-response.util";

// A draft is temporary/short-lived JSON stored on an AiJob or a report's
// confirmedData, so one already in flight across a deploy may still use the
// pre-migration `priority: "low"|"normal"|"high"` shape instead of the
// current `isPriority: boolean`. extractTasksToCreate must read both so
// confirming an old in-flight draft doesn't silently drop its priority flag.
describe("extractTasksToCreate", () => {
  it("reads the current isPriority boolean field", () => {
    const tasks = extractTasksToCreate({
      tasksToCreate: [
        { title: "Follow up", isPriority: true },
        { title: "Low-key follow up", isPriority: false },
      ],
    });

    assert.equal(tasks[0]?.isPriority, true);
    assert.equal(tasks[1]?.isPriority, false);
  });

  it("falls back to the legacy priority: \"high\" field for an in-flight draft", () => {
    const tasks = extractTasksToCreate({
      tasksToCreate: [{ title: "Legacy high priority", priority: "high" }],
    });

    assert.equal(tasks[0]?.isPriority, true);
  });

  it("treats legacy priority: \"normal\"/\"low\" as not priority", () => {
    const tasks = extractTasksToCreate({
      tasksToCreate: [
        { title: "Legacy normal", priority: "normal" },
        { title: "Legacy low", priority: "low" },
      ],
    });

    assert.equal(tasks[0]?.isPriority, false);
    assert.equal(tasks[1]?.isPriority, false);
  });

  it("defaults to not priority when neither field is present", () => {
    const tasks = extractTasksToCreate({
      tasksToCreate: [{ title: "No priority field at all" }],
    });

    assert.equal(tasks[0]?.isPriority, false);
  });
});
