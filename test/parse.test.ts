import { strict as assert } from "node:assert";
import { test } from "node:test";
import { formatDue, formatTimeRange, moveToDate, parseTask, parseTimeRange } from "../src/parse.ts";

// Wednesday 7 October 2026, 21:00 local time
const NOW = new Date(2026, 9, 7, 21, 0);

const cases: [string, string, string | undefined][] = [
  ["buy boots tomorrow", "buy boots", "2026-10-08"],
  ["submit report by friday", "submit report", "2026-10-09"],
  ["call mum", "call mum", undefined],
  ["football practice next tuesday", "football practice", "2026-10-13"],
  ["pay rent on 1 november", "pay rent", "2026-11-01"],
  ["dentist in 3 days", "dentist", "2026-10-10"],
  ["read chapter 2", "read chapter 2", undefined],
  ["email Sam about the 5 tickets", "email Sam about the 5 tickets", undefined],
  ["tomorrow gym", "gym", "2026-10-08"],
  ["book flights 1/11", "book flights", "2026-11-01"],
  ["  extra   spaces   today ", "extra spaces", "2026-10-07"],
];

for (const [input, title, due] of cases) {
  test(`parses "${input}"`, () => {
    assert.deepEqual(parseTask(input, NOW), due ? { title, due } : { title });
  });
}

test("formats due dates", () => {
  assert.equal(formatDue("2026-10-07", NOW), "Today");
  assert.equal(formatDue("2026-10-08", NOW), "Tomorrow");
  assert.equal(formatDue("2026-10-09", NOW), "Fri 9 Oct");
  assert.equal(formatDue("2027-01-04", NOW), "Mon 4 Jan 2027");
});

const times: [string, string | undefined][] = [
  ["2pm-3:30pm", "14:00–15:30"],
  ["14:00-15:30", "14:00–15:30"],
  ["2-3pm", "14:00–15:00"],
  ["9am to 5pm", "09:00–17:00"],
  ["2pm", "14:00–15:00"],
  ["11pm-1am", "23:00–01:00"],
  ["afternoon", undefined],
  ["soon", undefined],
];

for (const [input, expected] of times) {
  test(`reads time "${input}"`, () => {
    const range = parseTimeRange(input, "2026-10-08");
    assert.equal(range && formatTimeRange(range), expected);
  });
}

test("times land on the due date", () => {
  const range = parseTimeRange("11pm-1am", "2026-10-08");
  assert.deepEqual(range, { start: new Date(2026, 9, 8, 23, 0), end: new Date(2026, 9, 9, 1, 0) });
  assert.deepEqual(parseTimeRange("tomorrow 2pm", "2026-10-20")?.start, new Date(2026, 9, 20, 14, 0));
});

test("times typed in the task become a time range", () => {
  assert.deepEqual(parseTask("SSHS 10am-12pm tomorrow", NOW), {
    title: "SSHS",
    due: "2026-10-08",
    time: { start: new Date(2026, 9, 8, 10, 0), end: new Date(2026, 9, 8, 12, 0) },
  });
  assert.deepEqual(parseTask("dentist friday at 2pm", NOW), {
    title: "dentist",
    due: "2026-10-09",
    time: { start: new Date(2026, 9, 9, 14, 0), end: new Date(2026, 9, 9, 15, 0) },
  });
  assert.equal(parseTask("submit report by friday", NOW).time, undefined);
});

test("moving a time range to another day keeps the clock times", () => {
  const range = parseTimeRange("10am-12pm", "2026-10-08")!;
  assert.deepEqual(moveToDate(range, "2026-10-26"), {
    start: new Date(2026, 9, 26, 10, 0),
    end: new Date(2026, 9, 26, 12, 0),
  });
});
