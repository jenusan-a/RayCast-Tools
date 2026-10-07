import { getPreferenceValues } from "@raycast/api";
import { getAccessToken, OAuthService } from "@raycast/utils";
import { toISODate } from "./parse";

const { clientId } = getPreferenceValues<{ clientId: string }>();

const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** Google sign-in, handled by Raycast (tokens are stored and refreshed for you). */
export const google = OAuthService.google({
  clientId,
  scope: `${TASKS_SCOPE} ${CALENDAR_SCOPE}`,
});

// Raycast keeps reusing a saved token even after the scopes change, so drop one
// from before calendar access was added and sign in again.
const authorize = google.authorize.bind(google);
google.authorize = async () => {
  const tokens = await google.client.getTokens();
  if (tokens?.accessToken && !tokens.scope?.split(" ").includes(CALENDAR_SCOPE)) {
    await google.client.removeTokens();
  }
  return authorize();
};

const API = "https://tasks.googleapis.com/tasks/v1";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type TaskList = { id: string; title: string };

export type Task = {
  id: string;
  title: string;
  notes?: string;
  status: "needsAction" | "completed";
  /** RFC 3339, but Google only stores the date part. */
  due?: string;
  webViewLink?: string;
};

async function request<T>(path: string, init: RequestInit = {}, base = API): Promise<T> {
  const { token } = getAccessToken();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // keep the status text
    }
    throw new Error(message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function getTaskLists(): Promise<TaskList[]> {
  const data = await request<{ items?: TaskList[] }>("/users/@me/lists?maxResults=100");
  return data.items ?? [];
}

export async function getTasks(listId: string): Promise<Task[]> {
  const tasks: Task[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ showCompleted: "false", maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await request<{ items?: Task[]; nextPageToken?: string }>(
      `/lists/${encodeURIComponent(listId)}/tasks?${params}`,
    );
    tasks.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return tasks;
}

/** `due` is YYYY-MM-DD; Google ignores any time part. */
export async function createTask(listId: string, task: { title: string; notes?: string; due?: string }): Promise<Task> {
  return request<Task>(`/lists/${encodeURIComponent(listId)}/tasks`, {
    method: "POST",
    body: JSON.stringify({
      title: task.title,
      ...(task.notes ? { notes: task.notes } : {}),
      ...(task.due ? { due: `${task.due}T00:00:00.000Z` } : {}),
    }),
  });
}

export async function completeTask(listId: string, taskId: string): Promise<void> {
  await request(`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "completed" }),
  });
}

export async function deleteTask(listId: string, taskId: string): Promise<void> {
  await request(`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
}

/** A timed event on your main Google Calendar, in this Mac's time zone. */
export async function createEvent(event: { title: string; notes?: string; start: Date; end: Date }): Promise<void> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await request(
    "/calendars/primary/events",
    {
      method: "POST",
      body: JSON.stringify({
        summary: event.title,
        ...(event.notes ? { description: event.notes } : {}),
        start: { dateTime: toLocalDateTime(event.start), timeZone },
        end: { dateTime: toLocalDateTime(event.end), timeZone },
      }),
    },
    CALENDAR_API,
  );
}

/** "2026-10-08T14:00:00", read by Google in the `timeZone` sent alongside it. */
function toLocalDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${toISODate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

/** Google returns "2026-10-08T00:00:00.000Z"; keep just the date so time zones can't shift it. */
export function dueDate(task: Task): string | undefined {
  return task.due?.slice(0, 10);
}
