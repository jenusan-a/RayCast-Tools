import { Action, ActionPanel, Form, Icon, popToRoot, showToast, Toast } from "@raycast/api";
import { useCachedPromise, withAccessToken } from "@raycast/utils";
import { useState } from "react";
import { createEvent, createTask, getTaskLists, google } from "./google";
import { formatDue, formatTimeRange, moveToDate, parseTask, parseTimeRange, toISODate } from "./parse";

function AddTask() {
  const [text, setText] = useState("");
  const [dueOverride, setDueOverride] = useState<Date | null>(null);
  const [timeText, setTimeText] = useState("");
  const { data: lists, isLoading } = useCachedPromise(getTaskLists, [], { initialData: [] });

  const parsed = parseTask(text);
  const hasTime = timeText.trim() !== "";
  // A time with no date means today.
  const due = dueOverride ? toISODate(dueOverride) : (parsed.due ?? (hasTime ? toISODate(new Date()) : undefined));
  // The Time field wins over a time typed in the task, e.g. "dentist 2pm".
  const time = hasTime
    ? due && parseTimeRange(timeText, due)
    : parsed.time && due
      ? moveToDate(parsed.time, due)
      : undefined;
  const timeError = hasTime && !time ? "Try 2pm-3:30pm or 14:00" : undefined;
  const preview = !parsed.title
    ? "–"
    : time && due
      ? `${parsed.title}  ·  📅 Calendar event ${formatDue(due)} ${formatTimeRange(time)}`
      : `${parsed.title}  ·  ☑️ Task ${due ? `due ${formatDue(due)}` : "with no due date"}`;

  async function handleSubmit(values: { listId: string; notes: string }) {
    if (!parsed.title) {
      await showToast({ style: Toast.Style.Failure, title: "Type a task first" });
      return;
    }
    if (timeError) {
      await showToast({ style: Toast.Style.Failure, title: "Couldn't read the time", message: timeError });
      return;
    }
    // A time means an appointment: it goes to Google Calendar instead of Tasks.
    const toast = await showToast({ style: Toast.Style.Animated, title: time ? "Adding event…" : "Adding task…" });
    try {
      if (time) await createEvent({ title: parsed.title, notes: values.notes, ...time });
      else await createTask(values.listId || "@default", { title: parsed.title, notes: values.notes, due });
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = time ? "Couldn't add event" : "Couldn't add task";
      toast.message = error instanceof Error ? error.message : String(error);
      return;
    }
    toast.style = Toast.Style.Success;
    toast.title = parsed.title;
    toast.message =
      time && due
        ? `📅 ${formatDue(due)} · ${formatTimeRange(time)}`
        : due
          ? `☑️ Due ${formatDue(due)}`
          : "☑️ No due date";
    await popToRoot();
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={time ? "Add Event" : "Add Task"} icon={Icon.Plus} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="text"
        title="Task"
        placeholder="submit report friday"
        value={text}
        onChange={setText}
        autoFocus
      />
      <Form.Description title="Preview" text={preview} />
      <Form.DatePicker
        id="due"
        title="Due Date"
        info="Optional. Overrides any date typed in the task."
        type={Form.DatePicker.Type.Date}
        value={dueOverride}
        onChange={setDueOverride}
      />
      <Form.TextField
        id="time"
        title="Time"
        placeholder="2pm-3:30pm"
        info="Optional. With a time, this becomes a Google Calendar event on the due date (today if there's none) instead of a task. Overrides a time typed in the task."
        value={timeText}
        onChange={setTimeText}
        error={timeError}
      />
      {!time && (
        <Form.Dropdown id="listId" title="List" storeValue>
          {lists.map((list) => (
            <Form.Dropdown.Item key={list.id} value={list.id} title={list.title} icon={Icon.List} />
          ))}
        </Form.Dropdown>
      )}
      <Form.TextArea id="notes" title="Notes" placeholder="Optional" />
    </Form>
  );
}

export default withAccessToken(google)(AddTask);
