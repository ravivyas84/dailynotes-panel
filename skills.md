# dailynotes-panel — Developer Skills Reference

Quick reference for working on this codebase with Claude Code.

---

## Build & Test

```bash
# Install dependencies
npm install

# Type-check + compile TypeScript → out/
npm run compile

# Run unit tests (Jest)
npm test

# Watch mode (compile on change)
npm run watch
```

Always run `npm run compile && npm test` before committing. Both must pass with zero errors.

---

## Project Layout

| Path | Role |
|---|---|
| `src/extension.ts` | All VS Code integration: providers, commands, event handlers, normalisation, rollover, copy-on-create |
| `src/taskParser.ts` | Pure logic: parse task lines, group by project, sort, format todo.md |
| `src/utils.ts` | Date helpers and daily-note file discovery |
| `src/__tests__/` | Jest unit tests (taskParser + utils; no VS Code API) |
| `package.json` | Manifest — commands, views, settings, activation events |

---

## Key Patterns

### Adding a new VS Code command

1. **`package.json`** — register in `contributes.commands` and `activationEvents`:
   ```json
   { "command": "dailyNotes.myCommand", "title": "dailyNotes: My Command" }
   ```
   ```json
   "onCommand:dailyNotes.myCommand"
   ```

2. **`src/extension.ts`** — inside `activate()`, add:
   ```typescript
   context.subscriptions.push(
       vscode.commands.registerCommand('dailyNotes.myCommand', async () => {
           // implementation
       })
   );
   ```

### Adding a new metadata token

Metadata tokens are stripped from task text and placed at the end of the line by normalization.

1. Extend the regex in **both** files:
   - `extension.ts`: `META_TOKEN_REGEX = /\b(id|cd|dd|due|NEW):([^\s]+)\b/gi`
   - `taskParser.ts`: `META_TOKEN = /\b(id|cd|dd|due|NEW):([^\s]+)\b/gi`

2. Add the field to the `Task` interface in `taskParser.ts`.

3. Handle extraction in `stripAndCollectMeta()` (extension.ts) and `parseAndStripMetadata()` (taskParser.ts).

4. Handle serialisation in `buildMetaSuffix()` (extension.ts).

### Accessing configuration

```typescript
function getNotesFolder(): { folderPath: string; dateFormat: DateFormatOption } | null {
    // already exists — call this wherever you need the folder path or date format
}
```

### Checking if a document is a daily note

```typescript
isDailyNoteDocument(document, cfg.folderPath, cfg.dateFormat)  // → boolean
```

### Getting today's date string

```typescript
formatToday(cfg.dateFormat)  // → "2026-02-21" or "20260221"
```

### Appending tasks to today's note

```typescript
await appendTaskLinesToTodayNote(
    ['- [ ] My new task id:abc cd:2026-02-21'],
    cfg   // { folderPath, dateFormat }
);
// Creates today's note with ## Tasks section if it doesn't exist.
```

### Applying an edit to a document and saving (with loop-guard)

```typescript
// Guard first so the triggered onDidSaveTextDocument skips this document.
normalizingDocuments.add(document.uri.toString());
try {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, range, newText);
    await vscode.workspace.applyEdit(edit);
    await document.save();
} finally {
    normalizingDocuments.delete(document.uri.toString());
}
```

---

## Task Line Format

```
- [ ] (A) Task description ~[[2026-02-21]] id:abc cd:2026-01-15 due:2026-02-25 dd:2026-02-21
```

The regex that parses this (`TASK_LINE_REGEX` in extension.ts / `taskParser.ts`):
```
/^(\s*-\s+\[([ xX])\]\s*)(?:\(([A-Z])\)\s+)?(.+?)\s*$/
  └── prefix ──────────── └── priority ────┘ └── body ─┘
```

Metadata tokens recognized (removed from body, moved to suffix):
- `id:` `cd:` `due:` `dd:`

Decorator tokens (stay in body text, not extracted):
- `~[[target]]` — task was copied/moved TO target
- `>[[source]]` — task originated FROM source

---

## Decorator Convention

| Decorator | Meaning | Written on |
|---|---|---|
| `~[[X]]` | Copied/moved **to** X | The original / source task |
| `>[[X]]` | Originated **from** X | The copy in the destination |

Both decorators survive normalization (they are not in `META_TOKEN_REGEX`).
Both are valid Obsidian wiki links — clickable in any markdown viewer.

---

## State Persisted in workspaceState

| Key | Type | Purpose |
|---|---|---|
| `copiedTaskIds` | `string[]` | IDs of tasks already copied to a daily note (copy-on-create) |
| `initializedNonDailyFiles` | `string[]` | Absolute paths of non-daily files whose first save has been processed |

Helpers: `getCopiedTaskIds()`, `saveCopiedTaskIds()`, `getInitializedNonDailyFiles()`, `saveInitializedNonDailyFiles()`.

---

## Event Handler Summary

| Event | Handler behaviour |
|---|---|
| `onWillSaveTextDocument` | Runs `computeTaskNormalizationEdits()` on any `.md` file; edits applied synchronously before save |
| `onDidSaveTextDocument` | Daily notes: runs `normalizeDailyNoteMetadata()` then `processUpdatedTodosFromDocument()`; non-daily `.md`: runs `copyNewTasksToTodayNote()` |
| `onDidChangeConfiguration` | Reconfigures autosave and refreshes tree views |
| `onDidChangeActiveTextEditor` | Saves previous editor if autosave enabled |
| `onDidChangeTextDocument` | Resets autosave cooldown timer |

`normalizingDocuments: Set<string>` is the loop-guard shared by all handlers. A document URI in this set is skipped by `onDidSaveTextDocument` to prevent infinite save loops.

---

## Adding Tests

Tests live in `src/__tests__/` and use Jest. They must not import `vscode` (no VS Code API available in Jest). Test only the pure-logic layers (`taskParser.ts`, `utils.ts`).

```typescript
import { parseTaskLine, parseTasksFromContent } from '../taskParser';

test('parses priority', () => {
    const task = parseTaskLine('- [ ] (A) My task id:abc cd:2026-02-21', 'src', '2026-02-21.md');
    expect(task?.priority).toBe('A');
});
```

---

## Git Workflow

Branch: `claude/add-task-rollover-command-ByP5L`

```bash
# Before starting work
git fetch origin claude/add-task-rollover-command-ByP5L
git pull origin claude/add-task-rollover-command-ByP5L

# After changes
npm run compile && npm test   # must pass
git add src/extension.ts src/taskParser.ts ...
git commit -m "Short description of what and why"
git push -u origin claude/add-task-rollover-command-ByP5L
```

Never push to `master` directly.
