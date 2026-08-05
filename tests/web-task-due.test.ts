import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeTaskDue, groupTasksByDue } from "../apps/web/lib/task-due";

// Today in the tenant timezone, as the tasks page resolves it.
const TODAY = "2026-08-06";

function task(
  dueDate: string | null,
  status: "in_progress" | "done" = "in_progress",
) {
  return { dueDate, status } as const;
}

describe("describeTaskDue", () => {
  it("reads a past due date as overdue, counting back whole days", () => {
    const due = describeTaskDue(task("2026-07-03"), TODAY);

    assert.equal(due.tone, "overdue");
    assert.equal(due.dayOffset, -34);
  });

  it("reads today's due date as today", () => {
    const due = describeTaskDue(task(TODAY), TODAY);

    assert.equal(due.tone, "today");
    assert.equal(due.dayOffset, 0);
  });

  it("reads a future due date as upcoming, counting forward", () => {
    const due = describeTaskDue(task("2026-08-09"), TODAY);

    assert.equal(due.tone, "upcoming");
    assert.equal(due.dayOffset, 3);
  });

  it("reads a missing due date as undated", () => {
    const due = describeTaskDue(task(null), TODAY);

    assert.deepEqual(due, { tone: "undated", dayOffset: null, dueAt: null });
  });

  // A done task is never late and never "due today": its date is only a record
  // of when it had been due, so the rail stops shouting about it.
  it("reads a finished task as done however far past its due date", () => {
    const done = describeTaskDue(task("2026-07-03", "done"), TODAY);

    assert.equal(done.tone, "done");
    assert.equal(done.dayOffset, -34);
    assert.equal(describeTaskDue(task(TODAY, "done"), TODAY).tone, "done");
    assert.equal(describeTaskDue(task(null, "done"), TODAY).tone, "done");
  });

  // formatDueDate renders the rail in UTC, so the instant behind it has to be
  // midnight UTC on the due day — anything else (a noon fudge, a local
  // midnight) prints a neighbouring day for some reader.
  it("hands out midnight UTC on the due day", () => {
    const due = describeTaskDue(task("2026-07-03"), TODAY);

    assert.equal(due.dueAt?.toISOString(), "2026-07-03T00:00:00.000Z");
  });

  it("counts across month and year boundaries, and over a DST switch", () => {
    assert.equal(
      describeTaskDue(task("2026-07-31"), "2026-08-01").dayOffset,
      -1,
    );
    assert.equal(
      describeTaskDue(task("2027-01-01"), "2026-12-31").dayOffset,
      1,
    );
    // Europe/Kyiv moves its clocks on 2026-10-25; the arithmetic is calendar
    // days, so that day is still exactly one day wide.
    assert.equal(
      describeTaskDue(task("2026-10-26"), "2026-10-25").dayOffset,
      1,
    );
  });

  it("accepts a full timestamp as well as a bare date", () => {
    const due = describeTaskDue(task("2026-08-09T00:00:00.000Z"), TODAY);

    assert.equal(due.tone, "upcoming");
    assert.equal(due.dayOffset, 3);
  });

  // A card whose rail cannot be trusted shows no date rather than a wrong one.
  it("treats an unreadable due date as no due date", () => {
    assert.equal(describeTaskDue(task("not-a-date"), TODAY).tone, "undated");
    assert.equal(describeTaskDue(task("2026-13-45"), TODAY).tone, "undated");
  });
});

describe("groupTasksByDue", () => {
  // The headings the open list is read under. Their order is the order a rep
  // works: what is already late, then the day's own work, then what is coming.
  it("bands the list late-first and drops bands with nothing in them", () => {
    const groups = groupTasksByDue(
      [task("2026-08-20"), task(null), task("2026-07-03"), task(TODAY)],
      TODAY,
    );

    assert.deepEqual(
      groups.map((group) => group.key),
      ["overdue", "today", "upcoming", "undated"],
    );
    assert.deepEqual(groupTasksByDue([task(null)], TODAY).length, 1);
    assert.deepEqual(groupTasksByDue([], TODAY), []);
  });

  it("sorts each dated band by due date, longest overdue first", () => {
    const groups = groupTasksByDue(
      [
        task("2026-07-04"),
        task("2026-08-20"),
        task("2026-07-03"),
        task("2026-08-09"),
      ],
      TODAY,
    );

    assert.deepEqual(
      groups.map((group) => group.entries.map((entry) => entry.task.dueDate)),
      [
        ["2026-07-03", "2026-07-04"],
        ["2026-08-09", "2026-08-20"],
      ],
    );
  });

  // Nothing to sort undated work by, so the order the list arrived in — the
  // API's own — is the order it keeps, rather than an arbitrary reshuffle.
  it("leaves the undated band in the order it was given", () => {
    const first = { dueDate: null, status: "in_progress" as const, id: "a" };
    const second = { dueDate: null, status: "in_progress" as const, id: "b" };
    const [group] = groupTasksByDue([second, first], TODAY);

    assert.deepEqual(
      group.entries.map((entry) => entry.task.id),
      ["b", "a"],
    );
  });

  // Banding asks about the date and nothing else: whether a task belongs in
  // this list at all is the caller's question, answered by its status filter.
  it("bands by date regardless of status", () => {
    const [group] = groupTasksByDue([task("2026-07-03", "done")], TODAY);

    assert.equal(group.key, "overdue");
    assert.equal(group.entries[0].due.tone, "done");
  });
});
