# Google Tasks Quick Add

A Raycast extension for adding Google Tasks and Calendar events in plain English, and ticking tasks off without opening a browser.

- **Quick Add Task**: type `buy boots tomorrow`, check the preview, press Enter.
- **Add Task**: the same, as a form with a list picker, notes, a date picker and a time field.
- **My Tasks**: open tasks grouped into Overdue, Today, Next 7 Days, Later and No Date. Enter completes a task, ⌃X deletes it.

## How it works

1. **Reading the text.** [chrono-node](https://github.com/wanasit/chrono) finds the date in what you type, using UK date order (`1/11` is 1 November). That phrase is cut out, and the rest becomes the title: `pay rent by friday` gives the title **pay rent**, due Friday.
2. **Task or event.** Google Tasks can only store dates, so:
   - Text with only a date, or no date, becomes a **task**.
   - Text with a clock time (`SSHS 10am-12pm tomorrow`) becomes a **Google Calendar event** instead. A single time is a one-hour event. Vague words like "tonight" only set the date.
3. **Talking to Google.** Raycast's built-in Google sign-in stores and refreshes your token. The extension calls the Google Tasks and Google Calendar REST APIs directly.
4. **Staying fast.** Lists and tasks are cached on disk, so My Tasks opens instantly while fresh data loads. Completing or deleting a task updates the screen straight away, and puts it back if Google rejects the change.

## Files

| File | What it does |
| --- | --- |
| `src/parse.ts` | Reads dates and times out of text, and formats them as "Tomorrow" or "14:00–15:30". It doesn't call Google. |
| `src/google.ts` | Google sign-in, plus every API call: get lists and tasks, create, complete and delete tasks, create events. |
| `src/quick-add.tsx` | Quick Add: a search bar with a live preview row. |
| `src/add-task.tsx` | The Add Task form. |
| `src/my-tasks.tsx` | The My Tasks list. |
| `test/parse.test.ts` | Tests for the date and time parsing (`npm test`). |
| `package.json` | Raycast manifest: the three commands, the Client ID preference and dependencies. |

## Setup

1. In [Google Cloud](https://console.cloud.google.com), create a project and enable the **Google Tasks API** and the **Google Calendar API**.
2. On the **OAuth consent screen**, choose **External** and add yourself as a test user.
3. Under **Credentials**, create an **OAuth client ID** with type **iOS** and bundle ID `com.raycast`, then copy the Client ID.
4. Run `npm install && npm run dev` and paste the Client ID when Raycast asks for it. On the first sign-in, Google warns the app is unverified; choose **Continue**.

Optional: set hotkeys in Raycast **Settings → Extensions → Google Tasks Quick Add**.
