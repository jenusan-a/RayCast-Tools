import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { useCachedPromise, useCachedState, withAccessToken } from "@raycast/utils";
import { completeTask, deleteTask, dueDate, getTaskLists, getTasks, google, Task } from "./google";
import { formatDue, toISODate } from "./parse";

type Group = { title: string; tasks: Task[] };

function groupByDue(tasks: Task[], now = new Date()): Group[] {
  const today = toISODate(now);
  const weekEnd = toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const groups: Record<string, Task[]> = { Overdue: [], Today: [], "Next 7 Days": [], Later: [], "No Date": [] };

  for (const task of tasks) {
    const due = dueDate(task);
    if (!due) groups["No Date"].push(task);
    else if (due < today) groups.Overdue.push(task);
    else if (due === today) groups.Today.push(task);
    else if (due <= weekEnd) groups["Next 7 Days"].push(task);
    else groups.Later.push(task);
  }

  const byDue = (a: Task, b: Task) => (dueDate(a) ?? "").localeCompare(dueDate(b) ?? "");
  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([title, list]) => ({ title, tasks: list.sort(byDue) }));
}

function MyTasks() {
  const [listId, setListId] = useCachedState<string>("selected-list", "@default");
  const { data: lists = [] } = useCachedPromise(getTaskLists);
  const { data: tasks = [], isLoading, mutate } = useCachedPromise(getTasks, [listId]);

  async function complete(task: Task) {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Completing…" });
    try {
      await mutate(completeTask(listId, task.id), {
        optimisticUpdate: (current) => current?.filter((t) => t.id !== task.id),
      });
      toast.style = Toast.Style.Success;
      toast.title = "Completed";
      toast.message = task.title;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Couldn't complete task";
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  async function remove(task: Task) {
    const confirmed = await confirmAlert({
      title: "Delete task?",
      message: task.title,
      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      await mutate(deleteTask(listId, task.id), {
        optimisticUpdate: (current) => current?.filter((t) => t.id !== task.id),
      });
      await showToast({ style: Toast.Style.Success, title: "Deleted", message: task.title });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Couldn't delete task",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const today = toISODate(new Date());
  const groups = groupByDue(tasks.filter((t) => t.title?.trim()));

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Filter tasks"
      searchBarAccessory={
        <List.Dropdown tooltip="Task List" value={listId} onChange={setListId}>
          <List.Dropdown.Item title="Default List" value="@default" icon={Icon.Star} />
          {lists.map((list) => (
            <List.Dropdown.Item key={list.id} title={list.title} value={list.id} icon={Icon.List} />
          ))}
        </List.Dropdown>
      }
    >
      {!isLoading && (
        <List.EmptyView icon={Icon.CheckCircle} title="All done" description="No open tasks in this list." />
      )}
      {groups.map((group) => (
        <List.Section key={group.title} title={group.title} subtitle={String(group.tasks.length)}>
          {group.tasks.map((task) => {
            const due = dueDate(task);
            return (
              <List.Item
                key={task.id}
                icon={Icon.Circle}
                title={task.title}
                subtitle={task.notes?.split("\n")[0]}
                accessories={
                  due
                    ? [
                        {
                          tag: { value: formatDue(due), color: due < today ? Color.Red : undefined },
                          icon: Icon.Calendar,
                        },
                      ]
                    : []
                }
                actions={
                  <ActionPanel>
                    <Action title="Complete Task" icon={Icon.CheckCircle} onAction={() => complete(task)} />
                    {task.webViewLink && <Action.OpenInBrowser title="Open in Google Tasks" url={task.webViewLink} />}
                    <Action.CopyToClipboard title="Copy Title" content={task.title} />
                    <Action
                      title="Delete Task"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      shortcut={Keyboard.Shortcut.Common.Remove}
                      onAction={() => remove(task)}
                    />
                    <Action
                      title="Refresh"
                      icon={Icon.ArrowClockwise}
                      shortcut={Keyboard.Shortcut.Common.Refresh}
                      onAction={() => mutate()}
                    />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ))}
    </List>
  );
}

export default withAccessToken(google)(MyTasks);
