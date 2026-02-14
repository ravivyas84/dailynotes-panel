# dailynotes-panel

A VS Code extension for managing daily notes with built-in task tracking. It provides a sidebar panel that lists your daily notes in date order, and an "Open Tasks" panel that aggregates uncompleted tasks across all notes — grouped by project, using [todo.txt](http://todotxt.org/) conventions.

![Create DailyNote](/resources/create-daily-note.gif)

## Features

- **Daily Notes Panel** — Lists all `.md` files matching `yyyymmdd` or `yyyy-mm-dd` format, sorted newest-first. Today's note gets a star icon.
- **Open Tasks Panel** — Aggregates all uncompleted tasks from every daily note, grouped by `+Project`, sorted by priority. Click a task to jump to its source note.
- **Task Rollover** — When creating today's note, uncompleted tasks from the most recent previous note are automatically carried forward.
- **Generate todo.md** — Scans all daily notes and writes a `todo.md` with every task grouped by project, including dates and priority.
- **Generate Sample Todo Data** — Creates (or appends to) `2000-01-01.md` with demo tasks and sample note text for quick walkthroughs.
- **Insert Title from Filename** — Converts the current filename into a heading at the cursor position (e.g., `my-meeting-notes` becomes `# My Meeting Notes`).
- **Optional Autosave + Todo Processing** — When enabled, autosaves dirty files every 10 seconds and on editor switch, then refreshes todo processing for changed daily-note files.

## Task Syntax

Write tasks in your daily notes using markdown checkboxes with optional [todo.txt](http://todotxt.org/)-style priority, project, and context tags:

```markdown
## Tasks

- [ ] (A) Fix critical login bug +Backend @work id:abc cd:2026-02-12 due:2026-02-20
- [ ] (B) Review design mockups +UI @work id:def cd:2026-02-12
- [x] (C) Update dependencies +Backend id:ghi cd:2026-02-12 dd:2026-02-14
- [ ] Buy groceries id:jkl cd:2026-02-12
```

| Element | Syntax | Example |
|---------|--------|---------|
| Priority | `(A)` through `(Z)` | `(A)` = highest |
| Project | `+ProjectName` | `+Backend`, `+UI` |
| Context | `@context` | `@work`, `@phone` |
| Completed | `[x]` or `[X]` | `- [x] Done task` |
| ID | `id:<id>` | `id:abc` |
| Create date | `cd:<date>` | `cd:2026-02-12` |
| Due date | `due:<date>` | `due:2026-02-20` |
| Done date | `dd:<date>` | `dd:2026-02-14` |

Tasks can have multiple project and context tags.

### Metadata Auto-Management

- The extension auto-adds `id:` and `cd:` to tasks when you save a daily note.
- `cd:` defaults to the date in the note filename.
- When a task is completed (`[x]`), the extension adds `dd:` using today’s date; if you un-complete it, `dd:` is removed.
- `due:` is user-managed (the extension does not add or change it).
- `id:`, `cd:`, `due:`, `dd:` are normalized to postfix tokens at the end of the task line on save (if you type them earlier in the line, they are moved to the end).
- Date token format matches your configured `dailyNotes.dateFormat`.

## Commands

| Command | Description |
|---------|-------------|
| `dailyNotes: Refresh Daily Notes` | Refresh both the daily notes and open tasks panels |
| `dailyNotes: Open Daily Note` | Open today's note (creates it if it doesn't exist, with task rollover) |
| `dailyNotes: Insert Title from Filename` | Insert the filename as a `# Heading` at the cursor |
| `dailyNotes: Generate todo.md from All Notes` | Scan all notes and write a grouped `todo.md` |
| `dailyNotes: Generate Sample Todo Data` | Create/append `2000-01-01.md` with sample tasks for demos, then refresh todo processing |

### Command Details

#### `dailyNotes: Generate Sample Todo Data`

- Creates `2000-01-01.md` in your configured `dailyNotes.folder` if it does not exist.
- Adds a sample note header and demo task list using priorities, projects, contexts, completed and uncompleted tasks.
- If `2000-01-01.md` already exists, appends another generated sample block instead of overwriting.
- Reprocesses tasks and refreshes the **Open Tasks** tree so demo data appears immediately.

#### First-Open Demo Prompt

- The first time the **Daily Notes** panel is opened, the extension prompts you to run demo setup.
- If you choose **Run Demo Now**, it runs `dailyNotes: Generate Sample Todo Data` automatically.
- If you choose **Later**, nothing is changed.

## Extension Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `dailyNotes.folder` | `string` | `""` | Folder where daily notes are stored (relative to workspace root) |
| `dailyNotes.dateFormat` | `enum` | `yyyy-mm-dd` | Filename date format: `yyyymmdd` or `yyyy-mm-dd` |
| `dailyNotes.autoSaveEnabled` | `boolean` | `false` | Autosave dirty files every 10 seconds and on editor switch; process updated daily-note todos after autosaves |

## Demo Quick Start

1. Set `dailyNotes.folder` in VS Code settings.
2. Open the **Daily Notes** panel.
3. On first open, choose **Run Demo Now** (or run `dailyNotes: Generate Sample Todo Data` manually).
4. Open `2000-01-01.md` and save once to let the extension add `id:`/`cd:`/`dd:` tokens and normalize any `due:` tokens to the end.
5. Run `dailyNotes: Generate todo.md from All Notes` to produce a grouped `todo.md`.
6. (Optional) Enable `dailyNotes.autoSaveEnabled` to autosave every 10 seconds and on editor switch with automatic todo refresh processing.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [VS Code](https://code.visualstudio.com/) (v1.95.0+)

### Setup

```bash
git clone https://github.com/ravivyas84/dailynotes-panel.git
cd dailynotes-panel
npm install
```

### Build

```bash
# Compile TypeScript to JavaScript (output in out/)
npm run compile

# Watch mode — recompiles on file changes
npm run watch
```

### Test

```bash
# Run all unit tests
npm test
```

Tests use [Jest](https://jestjs.io/) with [ts-jest](https://kulshekhar.github.io/ts-jest/). Test files live in `src/__tests__/`.

### Run in VS Code (debug)

1. Open this project in VS Code
2. Press `F5` (or **Run > Start Debugging**)
3. A new VS Code window opens with the extension loaded
4. Configure `dailyNotes.folder` in the new window's settings
5. Use the Daily Notes icon in the activity bar

### Package

```bash
# Build a .vsix file for distribution
npm run package
```

This requires [vsce](https://github.com/microsoft/vscode-vsce) (`npm install -g @vscode/vsce`).

To install the packaged extension:

```bash
code --install-extension dailynotes-panel-0.0.4.vsix
```

## Project Structure

```
src/
├── extension.ts          # Extension entry point, commands, tree views
├── utils.ts              # Date parsing, filename utilities
├── taskParser.ts         # Task parsing, grouping, formatting
└── __tests__/
    ├── utils.test.ts     # Tests for date/filename utilities
    └── taskParser.test.ts # Tests for task parser
```

## Providing Feedback

You can raise an issue on the [GitHub repo](https://github.com/ravivyas84/dailynotes-panel/issues).

## Known Issues

- Today's note is not automatically selected in the panel when opened

## Release Notes

### 0.0.6 (Current)

**Note:** `0.0.5` was skipped. The current release is `0.0.6`.

- Added `dailyNotes: Generate Sample Todo Data` command to create/append `2000-01-01.md` with demo tasks.
- Added first-open Daily Notes panel prompt to run demo setup quickly.
- Added empty-state action in the Daily Notes panel to generate demo data when no notes exist.
- Added `dailyNotes.autoSaveEnabled` setting to autosave dirty files every 10 seconds and on editor switch.
- After autosave, daily-note task changes are reprocessed and todo output is refreshed.
- Updated documentation for new commands, settings, and demo quick start.

### 0.0.5 (Skipped)

**Note:** Version `0.0.5` was intentionally skipped.

- Migrated from moment.js to date-fns (smaller bundle)
- Added task parser with todo.txt-style syntax (priority, +project, @context)
- Added "Open Tasks" tree view panel grouped by project
- Added `dailyNotes: Generate todo.md from All Notes` command
- Added task rollover — uncompleted tasks carry forward to new daily notes
- Added unit tests (60 tests covering utils and task parser)
- Extracted pure logic into `utils.ts` and `taskParser.ts` for testability

### 0.0.4

**Date:** 2025-01-06

- Added an icon for the extension.

### 0.0.3

**Date:** 2025-01-04

- Showing a message when daily notes folder is not set

### 0.0.2

**Date:** 2024-12-15

- Fixed the readme file

### 0.0.1

**Date:** 2024-12-15

- First release
