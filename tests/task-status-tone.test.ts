import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { statusPillTone } from "../apps/web/lib/format";
import { taskStatuses, taskStatusTone } from "../apps/web/lib/task-status";

// Task pills deliberately diverge from the shared statusPillTone mapping: the
// active/in-progress task is the one that must draw the eye, so it takes the
// accent tone while done recedes to neutral. This is the reverse of what
// statusPillTone would give (done -> accent via "active", in_progress -> info),
// so the two must not be allowed to drift back together.

describe("taskStatusTone (task pill emphasis)", () => {
  it("gives the actively-moving task the accent tone", () => {
    assert.equal(taskStatusTone("in_progress"), "active");
  });

  it("lets a done task recede to the neutral tone", () => {
    assert.equal(taskStatusTone("done"), "neutral");
  });

  it("never colours in_progress and done the same", () => {
    assert.notEqual(taskStatusTone("in_progress"), taskStatusTone("done"));
  });

  it("covers every task status", () => {
    for (const status of taskStatuses) {
      assert.ok(
        ["active", "neutral"].includes(taskStatusTone(status)),
        `unexpected tone for ${status}`,
      );
    }
  });

  it("reverses the shared statusPillTone emphasis for tasks", () => {
    // statusPillTone would collapse done onto the accent and push in_progress
    // to info; taskStatusTone exists precisely to override that for tasks.
    assert.equal(statusPillTone("done"), "active");
    assert.equal(statusPillTone("in_progress"), "info");
    assert.notEqual(taskStatusTone("done"), statusPillTone("done"));
    assert.notEqual(
      taskStatusTone("in_progress"),
      statusPillTone("in_progress"),
    );
  });
});
