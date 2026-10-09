/** `label` is the time shown under the title, e.g. "14:00–15:30". */
export type Bar = { id: string; title: string; label: string; start: Date; end: Date };

const WIDTH = 480;
const GUTTER = 48; // hour labels
const HOUR = 44; // px per hour
const ALL_DAY = 24; // px per all-day row
const PAD = 8;
/** Hours shown at once; Raycast can't scroll the detail pane, so the window moves instead. */
const WINDOW_HOURS = 6;

const COLORS = {
  grid: "#8a8f98",
  label: "#8a8f98",
  bar: "#5b6b8c",
  past: "#a3a8b0",
  selected: "#3b82f6",
  now: "#ef4444",
  text: "#ffffff",
};

/** Bars other than the selected one are faded to this opacity. */
const FADED = 0.4;

/**
 * Lay events side by side when they overlap: each one gets a column, and every
 * event in an overlapping cluster shares the cluster's column count.
 */
export function layoutColumns(bars: Bar[]): Map<string, { column: number; columns: number }> {
  const sorted = [...bars].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
  const result = new Map<string, { column: number; columns: number }>();
  let cluster: { bar: Bar; column: number }[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const { bar, column } of cluster) result.set(bar.id, { column, columns: columnEnds.length });
    cluster = [];
    columnEnds = [];
  };

  for (const bar of sorted) {
    if (bar.start.getTime() >= clusterEnd) flush();
    let column = columnEnds.findIndex((end) => end <= bar.start.getTime());
    if (column === -1) column = columnEnds.push(0) - 1;
    columnEnds[column] = bar.end.getTime();
    cluster.push({ bar, column });
    clusterEnd = Math.max(clusterEnd, bar.end.getTime());
  }
  flush();
  return result;
}

/**
 * An SVG picture of part of one day (YYYY-MM-DD): hour grid, a bar per event and a line at the
 * current time. It shows a few hours; see `visibleHours` for which.
 */
export function renderTimeline(
  day: string,
  timed: Bar[],
  allDay: { id: string; title: string }[],
  selectedId?: string,
  now = new Date(),
  current?: number,
): string {
  const [y, m, d] = day.split("-").map(Number);
  const dayStart = new Date(y, m - 1, d).getTime();
  const dayEnd = new Date(y, m - 1, d + 1).getTime();
  const minutes = (date: Date) => (Math.min(Math.max(date.getTime(), dayStart), dayEnd) - dayStart) / 60000;

  const { firstHour, lastHour } = visibleHours(day, timed, selectedId, now, current);
  const clip = (mins: number) => Math.min(Math.max(mins, firstHour * 60), lastHour * 60);

  const top = PAD + allDay.length * ALL_DAY + (allDay.length ? PAD : 0);
  const height = top + (lastHour - firstHour) * HOUR + PAD;
  const yAt = (mins: number) => top + ((mins - firstHour * 60) / 60) * HOUR;
  const parts: string[] = [];

  // With an event selected, the rest fade so it stands out.
  const group = (id: string, content: string[]) =>
    selectedId && id !== selectedId ? `<g opacity="${FADED}">${content.join("")}</g>` : content.join("");

  allDay.forEach((event, i) => {
    const fill = event.id === selectedId ? COLORS.selected : COLORS.bar;
    const y0 = PAD + i * ALL_DAY;
    parts.push(
      group(event.id, [
        `<rect x="${GUTTER}" y="${y0}" width="${WIDTH - GUTTER - PAD}" height="${ALL_DAY - 4}" rx="4" fill="${fill}"/>`,
        text(GUTTER + 8, y0 + 14, event.title, WIDTH - GUTTER - PAD - 16, 12, "600"),
      ]),
    );
  });

  for (let hour = firstHour; hour <= lastHour; hour++) {
    const y0 = yAt(hour * 60);
    parts.push(
      `<line x1="${GUTTER - 4}" y1="${y0}" x2="${WIDTH - PAD}" y2="${y0}" stroke="${COLORS.grid}" stroke-opacity="0.3"/>`,
      `<text x="${GUTTER - 10}" y="${y0 + 4}" text-anchor="end" font-size="11" fill="${COLORS.label}" font-family="-apple-system, Helvetica, sans-serif">${String(hour % 24).padStart(2, "0")}:00</text>`,
    );
  }

  const columns = layoutColumns(timed);
  const trackWidth = WIDTH - GUTTER - PAD;
  for (const bar of timed) {
    const { column, columns: count } = columns.get(bar.id)!;
    const w = trackWidth / count;
    const x = GUTTER + column * w;
    const from = clip(minutes(bar.start));
    const to = clip(minutes(bar.end));
    if (to <= from && minutes(bar.start) !== minutes(bar.end)) continue; // outside the window
    const y0 = yAt(from);
    const h = Math.max(yAt(to) - y0, 18);
    const selected = bar.id === selectedId;
    const fill = selected ? COLORS.selected : bar.end <= now ? COLORS.past : COLORS.bar;
    const content = [
      `<rect x="${x + 1}" y="${y0 + 1}" width="${w - 2}" height="${h - 2}" rx="5" fill="${fill}"${selected ? ` stroke="${COLORS.text}" stroke-width="2"` : ""}/>`,
      text(x + 8, y0 + 15, bar.title, w - 16, 12, "600"),
    ];
    if (h >= 36) content.push(text(x + 8, y0 + 30, bar.label, w - 16, 11, "400", 0.85));
    parts.push(group(bar.id, content));
  }

  const nowMins = (now.getTime() - dayStart) / 60000;
  if (now.getTime() >= dayStart && now.getTime() < dayEnd && nowMins >= firstHour * 60 && nowMins <= lastHour * 60) {
    const y0 = yAt(nowMins);
    parts.push(
      `<line x1="${GUTTER}" y1="${y0}" x2="${WIDTH - PAD}" y2="${y0}" stroke="${COLORS.now}" stroke-width="2"/>`,
      `<circle cx="${GUTTER}" cy="${y0}" r="4" fill="${COLORS.now}"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">${parts.join("")}</svg>`;
}

/**
 * The hours to show. With no `current` window yet, centre on the selected event (else now on
 * today, else the first event, else 8:00). After that the window stays put and only scrolls,
 * just enough, when the selected event goes past its top or bottom edge.
 */
export function visibleHours(
  day: string,
  timed: Bar[],
  selectedId?: string,
  now = new Date(),
  current?: number,
): { firstHour: number; lastHour: number } {
  const [y, m, d] = day.split("-").map(Number);
  const dayStart = new Date(y, m - 1, d).getTime();
  const dayEnd = new Date(y, m - 1, d + 1).getTime();
  const minutes = (date: Date) => (Math.min(Math.max(date.getTime(), dayStart), dayEnd) - dayStart) / 60000;
  const span = (firstHour: number) => {
    const first = Math.max(0, Math.min(firstHour, 24 - WINDOW_HOURS));
    return { firstHour: first, lastHour: first + WINDOW_HOURS };
  };

  const selected = timed.find((bar) => bar.id === selectedId);

  if (current !== undefined) {
    if (!selected) return span(current);
    const from = minutes(selected.start);
    const to = minutes(selected.end);
    if (from < current * 60) return span(Math.floor(from / 60)); // past the top edge
    if (to > (current + WINDOW_HOURS) * 60) {
      // Past the bottom edge: scroll until the end fits, but never so far the start drops off.
      return span(Math.min(Math.ceil(to / 60) - WINDOW_HOURS, Math.floor(from / 60)));
    }
    return span(current);
  }

  const isToday = now.getTime() >= dayStart && now.getTime() < dayEnd;
  const first = [...timed].sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  const [from, to] = selected
    ? [minutes(selected.start), minutes(selected.end)]
    : isToday
      ? [minutes(now), minutes(now)]
      : first
        ? [minutes(first.start), minutes(first.end)]
        : [8 * 60, 8 * 60];

  // Centre the focus, but always show where it starts (long events run off the bottom).
  const centred = Math.round((from + to) / 2 / 60 - WINDOW_HOURS / 2);
  return span(Math.min(centred, Math.floor(from / 60) - (to - from < WINDOW_HOURS * 60 ? 0 : 1)));
}

/** Markdown that shows the SVG as an image. */
export function svgMarkdown(svg: string): string {
  return `![Timeline](data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")})`;
}

function text(x: number, y: number, value: string, maxWidth: number, size: number, weight: string, opacity = 1) {
  // No text measuring in SVG, so trim by an average character width.
  const maxChars = Math.max(1, Math.floor(maxWidth / (size * 0.58)));
  const clipped = value.length > maxChars ? `${value.slice(0, Math.max(1, maxChars - 1))}…` : value;
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${COLORS.text}" fill-opacity="${opacity}" font-family="-apple-system, Helvetica, sans-serif">${escapeXml(clipped)}</text>`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
