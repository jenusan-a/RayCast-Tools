import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Form,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { MutatePromise, useCachedPromise, withAccessToken } from "@raycast/utils";
import { ReactElement, useEffect, useState } from "react";
import {
  CalendarEvent,
  completeTask,
  deleteEvent,
  dueDate,
  getEvents,
  getTaskLists,
  getTasks,
  google,
  Task,
  updateEventTime,
} from "./google";
import { formatDue, formatTimeRange, parseTimeRange, TimeRange, toISODate } from "./parse";
import { Bar, renderTimeline, svgMarkdown, visibleHours } from "./timeline";

type DayTask = Task & { listId: string; listTitle: string };

/** Open tasks from every list due on `day`, plus anything overdue when `day` is today. */
async function getDayTasks(day: string): Promise<DayTask[]> {
  const today = toISODate(new Date());
  const lists = await getTaskLists();
  const perList = await Promise.all(
    lists.map(async (list) =>
      (await getTasks(list.id)).map((task) => ({ ...task, listId: list.id, listTitle: list.title })),
    ),
  );
  return perList
    .flat()
    .filter((task) => {
      const due = dueDate(task);
      return task.title?.trim() && due && (due === day || (day === today && due < today));
    })
    .sort((a, b) => (dueDate(a) ?? "").localeCompare(dueDate(b) ?? ""));
}

const titleOf = (event: CalendarEvent) => event.summary || "(No title)";
const timeOf = (event: CalendarEvent): TimeRange => ({
  start: new Date(event.start.dateTime!),
  end: new Date(event.end.dateTime!),
});
/** Compare as times, not strings: Google sends "+01:00" offsets, toISOString() writes "Z". */
const startTime = (event: CalendarEvent) => new Date(event.start.dateTime ?? event.start.date ?? 0).getTime();
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The timeline view, kept outside React state in case Raycast re-creates My Day. */
let savedView: { day?: string; start?: number; selectedId?: string } = {};

function MyDay() {
  const now = new Date();
  const today = toISODate(now);
  const [day, setDay] = useState(today);
  const days = Array.from({ length: 7 }, (_, i) =>
    toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)),
  );

  const { data: events = [], isLoading: eventsLoading, mutate: mutateEvents } = useCachedPromise(getEvents, [day]);
  const { data: tasks = [], isLoading: tasksLoading, mutate: mutateTasks } = useCachedPromise(getDayTasks, [day]);

  const allDay = events.filter((event) => event.start.date);
  const timed = events.filter((event) => event.start.dateTime);
  const bars: Bar[] = timed.map((event) => {
    const time = timeOf(event);
    return {
      id: event.id,
      title: titleOf(event),
      label: [formatTimeRange(time), event.location].filter(Boolean).join(" · "),
      ...time,
    };
  });
  const allDayBars = allDay.map((event) => ({ id: event.id, title: titleOf(event) }));
  // The timeline's first hour. It's kept between renders so the view only scrolls when the
  // selected event goes past an edge, rather than re-centring every time it moves. It lives
  // outside the component too, so it survives Raycast re-creating the view.
  const [windowStart, setWindowStartState] = useState<number | undefined>(() =>
    savedView.day === day ? savedView.start : undefined,
  );
  const [selectedId, setSelectedIdState] = useState<string | undefined>(() =>
    savedView.day === day ? savedView.selectedId : undefined,
  );
  function setWindowStart(start: number | undefined) {
    savedView = { ...savedView, day, start };
    setWindowStartState(start);
  }
  function setSelectedId(id: string | undefined) {
    savedView = { ...savedView, day, selectedId: id };
    setSelectedIdState(id);
  }

  useEffect(() => {
    console.debug("[my-day] view created", savedView);
    return () => console.debug("[my-day] view removed", savedView);
  }, []);
  const timeline = (id?: string) => svgMarkdown(renderTimeline(day, bars, allDayBars, id, now, windowStart));

  // Remember where the view ended up for the selected item, so the next move starts from there.
  const shownStart = selectedId ? visibleHours(day, bars, selectedId, now, windowStart).firstHour : windowStart;
  useEffect(() => {
    if (shownStart !== windowStart) setWindowStart(shownStart);
  }, [shownStart, windowStart]);

  function changeDay(newDay: string) {
    // Raycast also calls this when the list re-renders with the same day; keep the view then.
    if (newDay === day) return;
    setDay(newDay);
    savedView = { day: newDay };
    setWindowStartState(undefined);
    setSelectedIdState(undefined);
  }

  function refresh() {
    mutateEvents();
    mutateTasks();
  }

  /**
   * Pin the view to what's on screen for this event before moving it, so the move scrolls from
   * there (only past an edge) instead of re-centring. Doesn't rely on Raycast having reported
   * the selection, which it may not do for the row it selects on open.
   */
  function holdView(event: CalendarEvent) {
    setSelectedId(event.id);
    setWindowStart(visibleHours(day, bars, event.id, now, windowStart).firstHour);
  }

  async function shift(event: CalendarEvent, minutes: number) {
    holdView(event);
    const { start, end } = timeOf(event);
    const ms = minutes * 60000;
    await moveEvent(event, { start: new Date(start.getTime() + ms), end: new Date(end.getTime() + ms) }, mutateEvents, {
      quiet: true,
    });
  }

  async function cancel(event: CalendarEvent) {
    const isGuest = event.organizer && !event.organizer.self;
    const hasGuests = (event.attendees?.length ?? 0) > 0;
    const confirmed = await confirmAlert({
      title: isGuest ? "Remove event?" : "Cancel event?",
      message: `${titleOf(event)}${
        isGuest
          ? "\n\nYou're a guest, so this only removes it from your calendar."
          : hasGuests
            ? "\n\nGuests will be told it's cancelled."
            : ""
      }`,
      primaryAction: { title: isGuest ? "Remove" : "Cancel Event", style: Alert.ActionStyle.Destructive },
      dismissAction: { title: "Keep" },
    });
    if (!confirmed) return;
    const toast = await showToast({ style: Toast.Style.Animated, title: "Cancelling…" });
    try {
      await mutateEvents(deleteEvent(event.id), {
        optimisticUpdate: (current) => current?.filter((e) => e.id !== event.id),
      });
      toast.style = Toast.Style.Success;
      toast.title = "Cancelled";
      toast.message = titleOf(event);
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Couldn't cancel event";
      toast.message = errorMessage(error);
    }
  }

  async function complete(task: DayTask) {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Completing…" });
    try {
      await mutateTasks(completeTask(task.listId, task.id), {
        optimisticUpdate: (current) => current?.filter((t) => t.id !== task.id),
      });
      toast.style = Toast.Style.Success;
      toast.title = "Completed";
      toast.message = task.title;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Couldn't complete task";
      toast.message = errorMessage(error);
    }
  }

  const refreshAction = (
    <Action title="Refresh" icon={Icon.ArrowClockwise} shortcut={Keyboard.Shortcut.Common.Refresh} onAction={refresh} />
  );

  function eventActions(event: CalendarEvent, primary?: ReactElement) {
    return (
      <ActionPanel>
        {primary}
        {event.htmlLink && <Action.OpenInBrowser title="Open in Google Calendar" url={event.htmlLink} />}
        {event.hangoutLink && (
          <Action.OpenInBrowser title="Join Google Meet" icon={Icon.Video} url={event.hangoutLink} />
        )}
        {primary && (
          <>
            <Action
              title="Move 15 Minutes Later"
              icon={Icon.ArrowDown}
              shortcut={{ modifiers: ["cmd"], key: "]" }}
              onAction={() => shift(event, 15)}
            />
            <Action
              title="Move 15 Minutes Earlier"
              icon={Icon.ArrowUp}
              shortcut={{ modifiers: ["cmd"], key: "[" }}
              onAction={() => shift(event, -15)}
            />
          </>
        )}
        <Action.CopyToClipboard title="Copy Title" content={titleOf(event)} />
        <Action
          title="Cancel Event"
          icon={Icon.XMarkCircle}
          style={Action.Style.Destructive}
          shortcut={Keyboard.Shortcut.Common.Remove}
          onAction={() => cancel(event)}
        />
        {refreshAction}
      </ActionPanel>
    );
  }

  return (
    <List
      isLoading={eventsLoading || tasksLoading}
      isShowingDetail={events.length + tasks.length > 0}
      onSelectionChange={(id) => setSelectedId(id ?? undefined)}
      searchBarPlaceholder="Filter your day"
      searchBarAccessory={
        <List.Dropdown tooltip="Day" value={day} onChange={changeDay}>
          {days.map((d) => (
            <List.Dropdown.Item key={d} title={formatDue(d)} value={d} icon={Icon.Calendar} />
          ))}
        </List.Dropdown>
      }
    >
      <List.EmptyView
        icon={Icon.Calendar}
        title="Nothing planned"
        description={`No events or tasks for ${formatDue(day).toLowerCase()}.`}
      />
      {allDay.length > 0 && (
        <List.Section title="All Day">
          {allDay.map((event) => (
            <List.Item
              key={event.id}
              id={event.id}
              icon={Icon.Calendar}
              title={titleOf(event)}
              subtitle="All day"
              detail={<List.Item.Detail markdown={timeline(event.id)} />}
              actions={eventActions(event)}
            />
          ))}
        </List.Section>
      )}
      {timed.length > 0 && (
        <List.Section title="Schedule" subtitle={String(timed.length)}>
          {timed.map((event) => {
            const time = timeOf(event);
            const happening = time.start <= now && now < time.end;
            const over = time.end <= now;
            return (
              <List.Item
                key={event.id}
                id={event.id}
                icon={
                  happening
                    ? { source: Icon.CircleFilled, tintColor: Color.Green }
                    : over
                      ? Icon.CheckCircle
                      : Icon.Clock
                }
                title={titleOf(event)}
                subtitle={formatTimeRange(time)}
                keywords={event.location ? [event.location] : undefined}
                detail={<List.Item.Detail markdown={timeline(event.id)} />}
                actions={eventActions(
                  event,
                  <Action.Push
                    title="Change Time"
                    onPush={() => holdView(event)}
                    icon={Icon.Clock}
                    target={<ChangeTimeForm event={event} mutateEvents={mutateEvents} />}
                  />,
                )}
              />
            );
          })}
        </List.Section>
      )}
      {tasks.length > 0 && (
        <List.Section title="Tasks Due" subtitle={String(tasks.length)}>
          {tasks.map((task) => {
            const due = dueDate(task)!;
            return (
              <List.Item
                key={task.id}
                id={task.id}
                icon={due < today ? { source: Icon.Circle, tintColor: Color.Red } : Icon.Circle}
                title={task.title}
                subtitle={due < today ? `Overdue · ${formatDue(due)}` : task.listTitle}
                keywords={[task.listTitle]}
                detail={<List.Item.Detail markdown={timeline()} />}
                actions={
                  <ActionPanel>
                    <Action title="Complete Task" icon={Icon.CheckCircle} onAction={() => complete(task)} />
                    {task.webViewLink && <Action.OpenInBrowser title="Open in Google Tasks" url={task.webViewLink} />}
                    <Action.CopyToClipboard title="Copy Title" content={task.title} />
                    {refreshAction}
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      )}
    </List>
  );
}

/** Save new times, updating the list straight away; drops the event if it moved to another day. */
async function moveEvent(
  event: CalendarEvent,
  time: TimeRange,
  mutateEvents: MutatePromise<CalendarEvent[] | undefined>,
  { quiet = false } = {},
) {
  // Quick nudges stay silent unless they fail; the list already shows the new time.
  const toast = quiet ? undefined : await showToast({ style: Toast.Style.Animated, title: "Moving…" });
  const day = toISODate(new Date(event.start.dateTime!));
  try {
    await mutateEvents(updateEventTime(event.id, time), {
      optimisticUpdate: (current = []) =>
        toISODate(time.start) !== day
          ? current.filter((e) => e.id !== event.id)
          : current
              .map((e) =>
                e.id === event.id
                  ? { ...e, start: { dateTime: time.start.toISOString() }, end: { dateTime: time.end.toISOString() } }
                  : e,
              )
              .sort((a, b) => startTime(a) - startTime(b)),
      // Google's event list can lag behind the change for a moment, so refetching straight away
      // can briefly put the event back where it was. The list above is already right.
      shouldRevalidateAfter: false,
    });
    if (toast) {
      toast.style = Toast.Style.Success;
      toast.title = titleOf(event);
      toast.message = `${formatDue(toISODate(time.start))} · ${formatTimeRange(time)}`;
    }
    return true;
  } catch (error) {
    await showToast({ style: Toast.Style.Failure, title: "Couldn't move event", message: errorMessage(error) });
    return false;
  }
}

function ChangeTimeForm({
  event,
  mutateEvents,
}: {
  event: CalendarEvent;
  mutateEvents: MutatePromise<CalendarEvent[] | undefined>;
}) {
  const { pop } = useNavigation();
  const current = timeOf(event);
  const [date, setDate] = useState<Date | null>(current.start);
  const [timeText, setTimeText] = useState(formatTimeRange(current).replace("–", "-"));

  const day = toISODate(date ?? current.start);
  const time = parseTimeRange(timeText, day);
  const timeError = time ? undefined : "Try 2pm-3:30pm or 14:00-15:30";

  async function handleSubmit() {
    if (!time) {
      await showToast({ style: Toast.Style.Failure, title: "Couldn't read the time", message: timeError });
      return;
    }
    if (await moveEvent(event, time, mutateEvents)) pop();
  }

  return (
    <Form
      navigationTitle={`Change Time · ${titleOf(event)}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Time" icon={Icon.Clock} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description title="Event" text={titleOf(event)} />
      <Form.Description title="Now" text={`${formatDue(toISODate(current.start))} · ${formatTimeRange(current)}`} />
      <Form.DatePicker id="date" title="Date" type={Form.DatePicker.Type.Date} value={date} onChange={setDate} />
      <Form.TextField
        id="time"
        title="Time"
        placeholder="2pm-3:30pm"
        info="A single time keeps it an hour long."
        value={timeText}
        onChange={setTimeText}
        error={timeError}
        autoFocus
      />
      <Form.Description title="New" text={time ? `${formatDue(day)} · ${formatTimeRange(time)}` : "–"} />
    </Form>
  );
}

export default withAccessToken(google)(MyDay);
