# Plan for Today

A static MVP for a simple daily planning ritual.

Open `index.html` in a browser or host the folder with any static web server. The app stores only today's task stack in browser `localStorage`; there are no accounts, backend services, dashboards, or cross-day archives.

## What it does

- Starts with a local date, live clock, rotating daily headline, editable greeting, Add, and Clear today controls.
- Adds tasks inline in the checklist: press Add, type a task, Enter to save, Escape to cancel.
- Shows today's plan as one compact Notes-style checklist panel.
- Shows a daily progress bar based on completed tasks.
- Gives each task a visible Done checkbox, title/pencil editing, status tag, a small scheduled-time pill, and a subtle row delete icon.
- Expands one task at a time for title editing, explicit status selection, tap-based start/end time and duration presets, clear time, and delete.
- Reorders tasks by dragging checklist rows.
- Shows calm timer cues only when both times are set: scheduled, now, warning, urgent, late, or muted done-time.
- Softens Done tasks, stops their timer warnings, and keeps them in place.
- Confirms destructive Clear today and Start fresh actions.
- Confirms single-task deletes, then offers a short Undo window after deletion.

## Local storage

- `planForToday.currentDay`: `{ dateKey, tasks }`
- `planForToday.preferences`: `{ name }`

Tasks are tied to the stored `dateKey`. When the browser date changes, the app shows a new-day banner. Choosing `Start fresh` requires confirmation, then permanently clears the prior task stack and begins a new day.

If browser storage is unavailable, the app still works in memory and shows a warning that the plan may not survive refresh.

The app listens for `storage` changes from other tabs. If the user is not editing, it applies the latest saved plan automatically. If the inline Add row is open or the user is editing a field, it shows a small "Plan changed in another tab" banner so the user can choose when to apply the update.
