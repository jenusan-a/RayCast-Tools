import { strict as assert } from "node:assert";
import { test } from "node:test";
import { layoutColumns, renderTimeline, visibleHours } from "../src/timeline.ts";

const at = (h: number, m = 0) => new Date(2026, 9, 9, h, m);
const bar = (id: string, start: Date, end: Date) => ({ id, title: id, label: "", start, end });

test("events that don't overlap each get the full width", () => {
  const layout = layoutColumns([bar("a", at(9), at(10)), bar("b", at(10), at(11))]);
  assert.deepEqual(layout.get("a"), { column: 0, columns: 1 });
  assert.deepEqual(layout.get("b"), { column: 0, columns: 1 });
});

test("overlapping events sit side by side, and reuse a column once it frees up", () => {
  const layout = layoutColumns([
    bar("a", at(9), at(11)),
    bar("b", at(9, 30), at(10)),
    bar("c", at(10), at(10, 30)),
    bar("d", at(12), at(13)),
  ]);
  assert.deepEqual(layout.get("a"), { column: 0, columns: 2 });
  assert.deepEqual(layout.get("b"), { column: 1, columns: 2 });
  assert.deepEqual(layout.get("c"), { column: 1, columns: 2 });
  assert.deepEqual(layout.get("d"), { column: 0, columns: 1 });
});

test("the timeline escapes titles and scrolls to a selected late event", () => {
  const svg = renderTimeline("2026-10-09", [bar("<b>&", at(21), at(23))], [], "<b>&", at(12));
  assert.ok(svg.includes("&#60;b&#62;&#38;"));
  assert.ok(svg.includes(">23:00<"));
});

test("with an event selected, the others fade", () => {
  const bars = [bar("a", at(9), at(10)), bar("b", at(11), at(12))];
  const count = (svg: string) => svg.split("<g opacity=").length - 1;
  assert.equal(count(renderTimeline("2026-10-09", bars, [{ id: "c", title: "c" }], "a", at(8))), 2);
  assert.equal(count(renderTimeline("2026-10-09", bars, [], undefined, at(8))), 0);
});

test("the window follows the selected event", () => {
  const bars = [bar("early", at(7), at(8)), bar("late", at(18), at(19))];
  const early = visibleHours("2026-10-09", bars, "early", at(12));
  const late = visibleHours("2026-10-09", bars, "late", at(12));
  assert.ok(early.firstHour <= 7 && early.lastHour >= 8);
  assert.ok(late.firstHour <= 18 && late.lastHour >= 19);
  // Nothing selected on today: around now.
  const none = visibleHours("2026-10-09", bars, undefined, at(12));
  assert.ok(none.firstHour <= 12 && none.lastHour > 12);
});

test("the window stays inside the day", () => {
  assert.equal(visibleHours("2026-10-09", [bar("a", at(0), at(1))], "a").firstHour, 0);
  assert.equal(visibleHours("2026-10-09", [bar("a", at(23), at(23, 30))], "a").lastHour, 24);
});

test("once shown, the window stays put while the event is inside it", () => {
  // Window 10:00–16:00; nudging a 12:00 event to 12:15 doesn't move it.
  assert.equal(visibleHours("2026-10-09", [bar("a", at(12, 15), at(13, 15))], "a", at(8), 10).firstHour, 10);
});

test("the window scrolls just enough when the event passes an edge", () => {
  // Window 10:00–16:00: pushing the end to 16:15 scrolls one hour; pulling the start to 9:45 scrolls to 9:00.
  assert.equal(visibleHours("2026-10-09", [bar("a", at(15, 15), at(16, 15))], "a", at(8), 10).firstHour, 11);
  assert.equal(visibleHours("2026-10-09", [bar("a", at(9, 45), at(10, 45))], "a", at(8), 10).firstHour, 9);
  // An event longer than the window keeps its start in view.
  assert.equal(visibleHours("2026-10-09", [bar("a", at(12), at(20))], "a", at(8), 6).firstHour, 12);
});
