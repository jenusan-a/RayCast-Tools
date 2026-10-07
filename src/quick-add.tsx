import { Action, ActionPanel, closeMainWindow, Color, Icon, LaunchProps, List, showToast, Toast } from "@raycast/api";
import { withAccessToken } from "@raycast/utils";
import { useState } from "react";
import { setTimeout } from "timers/promises";
import { createEvent, createTask, google } from "./google";
import { formatDue, formatTimeRange, parseTask } from "./parse";

// A list rather than a command argument: Raycast's search bar uses the full window width,
// and the row below previews the title, date and time as separate parts while you type.
function QuickAdd({ fallbackText }: LaunchProps) {
  const [text, setText] = useState(fallbackText ?? "");
  const [isAdding, setIsAdding] = useState(false);
  const { title, due, time } = parseTask(text);

  async function add() {
    if (!title || isAdding) return;
    setIsAdding(true);
    // A time means an appointment: it goes to Google Calendar instead of Tasks.
    try {
      if (time) await createEvent({ title, ...time });
      else await createTask("@default", { title, due });
    } catch (error) {
      setIsAdding(false);
      await showToast({
        style: Toast.Style.Failure,
        title: time ? "Couldn't add event" : "Couldn't add task",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    await showToast({
      style: Toast.Style.Success,
      title,
      message: time
        ? `📅 ${formatDue(due!)} · ${formatTimeRange(time)}`
        : due
          ? `☑️ Due ${formatDue(due)}`
          : "☑️ No due date",
    });
    await setTimeout(1500);
    await closeMainWindow({ clearRootSearch: true });
  }

  const accessories: List.Item.Accessory[] = time
    ? [
        { tag: { value: formatDue(due!), color: Color.Blue }, icon: Icon.Calendar },
        { tag: { value: formatTimeRange(time), color: Color.Purple }, icon: Icon.Clock },
      ]
    : due
      ? [{ tag: { value: `Due ${formatDue(due)}`, color: Color.Green }, icon: Icon.Calendar }]
      : [{ text: "No due date" }];

  return (
    <List
      searchText={text}
      onSearchTextChange={setText}
      filtering={false}
      isLoading={isAdding}
      searchBarPlaceholder="buy boots tomorrow, or SSHS 10am-12pm tomorrow"
    >
      {title ? (
        <List.Item
          icon={time ? Icon.Calendar : Icon.Circle}
          title={title}
          subtitle={time ? "Google Calendar" : "Google Tasks"}
          accessories={accessories}
          actions={
            <ActionPanel>
              <Action title={time ? "Add Event" : "Add Task"} icon={Icon.Plus} onAction={add} />
            </ActionPanel>
          }
        />
      ) : (
        <List.EmptyView
          icon={Icon.Plus}
          title="Type a task"
          description={'Add a date ("friday") for a task, or a time ("10am-12pm tomorrow") for a calendar event.'}
        />
      )}
    </List>
  );
}

export default withAccessToken(google)(QuickAdd);
