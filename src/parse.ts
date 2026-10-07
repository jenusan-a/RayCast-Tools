import * as chrono from "chrono-node";

export type ParsedTask = {
  title: string;
  /** Due date as YYYY-MM-DD, or undefined when the text has no date. */
  due?: string;
  /** Set when the text gives a clock time, e.g. "10am-12pm tomorrow". */
  time?: TimeRange;
};

export type TimeRange = { start: Date; end: Date };

// Words left dangling once the date is removed: "pay rent by friday" -> "pay rent"
const TRAILING_WORDS = new Set(["by", "on", "due", "at", "for", "before", "until", "this", "next", "from"]);

/** Split "buy boots tomorrow" into { title: "buy boots", due: "2026-10-08" }. */
export function parseTask(input: string, now: Date = new Date()): ParsedTask {
  const text = input.trim().replace(/\s+/g, " ");
  if (!text) return { title: "" };

  // en.GB reads "1/11" as 1 November; forwardDate makes "friday" mean the next Friday.
  const results = chrono.en.GB.parse(text, now, { forwardDate: true });
  if (results.length === 0) return { title: text };

  const match = results[results.length - 1]; // the last date mentioned wins
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match.text.length);
  const words = `${before} ${after}`.trim().split(/\s+/).filter(Boolean);
  while (words.length && TRAILING_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();

  const due = toISODate(match.start.date());
  const time = clockRange(match, due);
  return { title: words.join(" ") || text, due, ...(time ? { time } : {}) };
}

/**
 * Read "2pm-3:30pm", "14:00–15:30" or "9am to 5pm" as times on `due` (YYYY-MM-DD).
 * A single time ("2pm") lasts an hour; an end before the start runs past midnight.
 */
export function parseTimeRange(input: string, due: string): TimeRange | undefined {
  const [y, m, d] = due.split("-").map(Number);
  const result = chrono.en.GB.parse(input.trim(), new Date(y, m - 1, d))[0];
  return result && clockRange(result, due);
}

/** The same clock times on another day, e.g. when the date picker overrides the typed date. */
export function moveToDate({ start, end }: TimeRange, due: string): TimeRange {
  const [y, m, d] = due.split("-").map(Number);
  const shift =
    new Date(y, m - 1, d).getTime() - new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  return { start: new Date(start.getTime() + shift), end: new Date(end.getTime() + shift) };
}

/** The clock times chrono found, placed on `due`; undefined when no hour was given. */
function clockRange(result: chrono.ParsedResult, due: string): TimeRange | undefined {
  if (!result.start.isCertain("hour")) return undefined;
  const [y, m, d] = due.split("-").map(Number);
  // Only the clock time is taken from the text; the day is always the due date.
  const at = (c: chrono.ParsedComponents) => new Date(y, m - 1, d, c.get("hour") ?? 0, c.get("minute") ?? 0);
  const start = at(result.start);
  const end = result.end?.isCertain("hour") ? at(result.end) : new Date(start.getTime() + 60 * 60 * 1000);
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end };
}

/** "14:00–15:30" */
export function formatTimeRange({ start, end }: TimeRange): string {
  const hhmm = (date: Date) =>
    `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${hhmm(start)}–${hhmm(end)}`;
}

/** Local calendar date as YYYY-MM-DD (avoids UTC shifting the day). */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "2026-10-08" -> "Thu 8 Oct", or "Today" / "Tomorrow". */
export function formatDue(due: string, now: Date = new Date()): string {
  const today = toISODate(now);
  const tomorrow = toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  if (due === today) return "Today";
  if (due === tomorrow) return "Tomorrow";
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const label = `${WEEKDAYS[date.getDay()]} ${d} ${MONTHS[m - 1]}`;
  return y === now.getFullYear() ? label : `${label} ${y}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
