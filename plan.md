# dailynotes-panel — Project Plan

## Vision

A VS Code extension for Obsidian-style daily notes with automatic task tracking. Tasks created anywhere in your vault flow into today's note automatically; uncompleted tasks can be rolled forward; a live sidebar keeps all open tasks visible across the workspace.

---

## Status: What's Built

### Core Infrastructure
- [x] **Date-formatted daily notes** — supports `yyyy-mm-dd` and `yyyymmdd` filename patterns
- [x] **Sidebar with three panels** — Daily Notes list, Calendar grid, To Do task tree
- [x] **Settings** — `dailyNotes.folder`, `dailyNotes.dateFormat`, `dailyNotes.autoSaveEnabled`
- [x] **Auto-save** — saves dirty files every 10 s; pauses 5 s after typing stops

### Task Metadata & Normalization
- [x] **Auto-ID assignment** (`id:abc123`) on every task on save
- [x] **Creation date** (`cd:`) — filename date for daily notes, today for other files
- [x] **Done date** (`dd:`) — stamped when task is checked `[x]`, removed on uncheck
- [x] **Due date** (`due:`) — user-supplied; preserved through normalization
- [x] **Metadata ordering** — tokens always sorted to end of line: `id:` `cd:` `due:` `dd:`
- [x] **Normalization runs on all .md files**, not just daily notes

### Task Decorators
- [x] **`~[[target]]`** — "copied/moved TO target"; written on the original/source task
- [x] **`>[[source]]`** — "originated FROM source"; written on the copy in the destination

### Rollover Commands
- [x] **`dailyNotes.rolloverAllTasks`** — rolls every uncompleted task in the active file to today
- [x] **`dailyNotes.rolloverTaskAtCursor`** — rolls just the task on the cursor line
- [x] **Cross-file propagation** — finds all copies of a task by `id:` and stamps `~[[today]]` on each
- [x] **Idempotent** — tasks already bearing `~[[today]]` are skipped

### Copy-on-Create (non-daily-note files)
- [x] **Auto-detect new tasks** on save of any non-daily-note `.md` file
- [x] **Bootstrap safe** — first save of a file records existing tasks as "pre-existing"; only tasks added after are copied
- [x] **Copy to today** — new tasks appear in today's `## Tasks` section with `>[[sourceFile]]`
- [x] **Mark source** — original task gets `~[[today]]` so you can see it was synced
- [x] **State persisted** — copied task IDs survive VS Code restarts (via `workspaceState`)

### Generate todo.md
- [x] **`dailyNotes.generateTodo`** — scans all daily notes; groups tasks by `+Project`
- [x] **Sorted output** — projects alphabetically, tasks by priority within each project
- [x] **Source links** — each task includes `— [[YYYY-MM-DD]]` link back to its origin

### Other Commands
- [x] `dailyNotes.refresh` — refresh all sidebar views
- [x] `dailyNotes.openNote` — open today's note (create if missing)
- [x] `dailyNotes.openNoteForDate` — open a specific date's note
- [x] `dailyNotes.addTitle` — insert `# YYYY-MM-DD` heading from filename
- [x] `dailyNotes.generateSampleTodo` — create demo data for first-time setup

---

## Roadmap: What's Next

### High Priority

- [ ] **Completed task rollover** — option to carry completed tasks forward with a summary section
- [ ] **Template support** — user-defined template file for new daily notes (instead of hard-coded stub)
- [ ] **`due:` warnings** — highlight or badge tasks approaching or past their due date in the To Do tree
- [ ] **Bi-directional sync** — if a task is completed in today's note, mark the corresponding copy in the source file complete too (via shared `id:`)
- [ ] **Filter by context** — To Do tree filter for `@context` tags (analogous to existing project grouping)

### Medium Priority

- [ ] **Incremental todo.md updates** — avoid re-scanning all files; track which notes changed since last generation
- [ ] **Archive completed tasks** — command to move all `[x]` tasks from a note to an `archive.md`
- [ ] **Weekly/monthly rollup** — generate a weekly summary note from daily notes in a date range
- [ ] **`>[[source]]` navigation** — clicking a `>[[file]]` decorator opens the source file (currently relies on Obsidian-style wiki-link rendering)
- [ ] **Task search** — quick-pick palette to search all tasks by text across all notes

### Low Priority / Nice-to-have

- [ ] **Recurring tasks** — `recur:daily` / `recur:weekly` metadata token; auto-creates copy in next note
- [ ] **Pomodoro integration** — start/stop timer from To Do tree; stamps time on task
- [ ] **Statistics view** — completed vs. open tasks per week, streaks, etc.
- [ ] **Export** — export tasks to CSV / JSON for external tools

---

## Known Issues & Technical Debt

| Area | Issue |
|---|---|
| **Performance** | Todo tree re-scans entire folder on every save — no caching |
| **Decorators** | `~[[X]]` / `>[[X]]` are plain text; deleting them silently breaks tracking |
| **Metadata regex** | Global regex state (`lastIndex`) must be manually reset; concurrent use could corrupt results |
| **Calendar** | Uses `color-mix()` CSS; may fail on very old VS Code/Chromium builds |
| **Copy-on-create** | `workspaceState` is per-workspace; IDs don't transfer if workspace config changes |
| **Date validation** | Invalid dates silently dropped; no user feedback |
| **Sample data** | Running `generateSampleTodo` multiple times appends duplicate blocks |
| **Architecture** | `extension.ts` is ~1800 lines; candidate for splitting into feature modules |

---

## Conventions Reference

### Task line format
```
- [ ] (A) Task description ~[[2026-02-21]] id:abc cd:2026-01-15 due:2026-02-25
  ^     ^  ^               ^               ^      ^              ^
  │     │  priority        decorator       id     creation date  due date
  │     checkbox
  list marker
```

### Metadata tokens (auto-normalized, moved to end of line)
| Token | Auto-set? | Description |
|---|---|---|
| `id:` | Yes | 3–10 char random alphanumeric; unique per workspace |
| `cd:` | Yes | Creation date; filename date for daily notes, today for other files |
| `dd:` | Yes | Done date; set when `[x]`, removed when unchecked |
| `due:` | No | User-supplied deadline |

### Decorator convention
| Decorator | Meaning |
|---|---|
| `~[[X]]` | "Copied/moved **to** X" — on the original task |
| `>[[X]]` | "Originated **from** X" — on the copy in the destination |

### Project & context tags (in task text)
- `+ProjectName` — groups task under that project in the To Do tree and todo.md
- `@contextName` — stored on task; filtering not yet implemented

---

## File Map

```
src/
  extension.ts    Main extension: providers, commands, event handlers, helpers
  taskParser.ts   Task parsing, formatting, grouping, sorting
  utils.ts        Date helpers, file discovery

resources/
  dailyNotes.svg  Activity bar icon

package.json      Manifest: commands, views, settings, activation events
tsconfig.json     TypeScript configuration
jest.config.js    Test configuration

src/__tests__/
  taskParser.test.ts   Parser unit tests (covering parsing, grouping, formatting)
  utils.test.ts        Date / file utility unit tests
```
