import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { DailyNote, DateFormatOption, getDateRegex, isToday, formatDate, formatToday, parseDateFromFilename, filenameToTitle, processNoteFiles } from './utils';
import { Task, parseTasksFromContent, getUncompletedTasks, groupTasksByProject, sortTasksByPriority, formatTodoMd, formatTaskLine, buildRolloverSection } from './taskParser';

const SAMPLE_NOTE_FILENAME = '2000-01-01.md';
const SAMPLE_NOTE_HEADER = '# Daily Note - 2000-01-01';
const SAMPLE_NOTE_INTRO = 'This is a sample note.';
const CONFIG_PLACEHOLDER_PATH = '__CONFIG_PLACEHOLDER__';
const DEMO_PLACEHOLDER_PATH = '__DEMO_PLACEHOLDER__';
const SAMPLE_TASKS = [
    '- [ ] (A) Fix critical login bug due:2000-01-05 +Backend @work',
    '- [ ] (A) Draft weekly roadmap +Planning @work',
    '- [ ] (B) Review UI spacing updates +UI due:2000-01-03 +Web @work',
    '- [ ] (B) Follow up with vendor about invoices +Finance @office',
    '- [ ] (C) Write release notes for the sprint +Docs @work',
    '- [x] (C) Update dependency versions +Backend',
    '- [ ] Buy groceries @home',
    '- [ ] Plan weekend trip +Personal @phone',
];

type TaskMeta = { id?: string; cd?: string; due?: string; dd?: string };
const TASK_LINE_REGEX = /^(\s*-\s+\[([ xX])\]\s*)(?:\(([A-Z])\)\s+)?(.+?)\s*$/;
const META_TOKEN_REGEX = /\b(id|cd|dd|due):([^\s]+)\b/gi;

function generateShortId(existingIds: Set<string>): string {
    for (let length = 3; length <= 10; length++) {
        for (let attempt = 0; attempt < 25; attempt++) {
            let candidate = '';
            while (candidate.length < length) {
                candidate += crypto.randomBytes(4).readUInt32BE(0).toString(36);
            }
            candidate = candidate.slice(0, length).toLowerCase();
            if (!existingIds.has(candidate)) {
                existingIds.add(candidate);
                return candidate;
            }
        }
    }

    // Extremely unlikely fallback.
    const fallback = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toLowerCase();
    existingIds.add(fallback);
    return fallback;
}

function stripAndCollectMeta(text: string): { cleanedText: string; meta: TaskMeta } {
    const meta: TaskMeta = {};
    const cleanedText = text
        .replace(META_TOKEN_REGEX, (_m, key: string, value: string) => {
            const k = String(key).toLowerCase();
            if (k === 'id') { meta.id = value; }
            if (k === 'cd') { meta.cd = value; }
            if (k === 'due') { meta.due = value; }
            if (k === 'dd') { meta.dd = value; }
            return '';
        })
        .replace(/\s+/g, ' ')
        .trim();

    META_TOKEN_REGEX.lastIndex = 0;
    return { cleanedText, meta };
}

function buildMetaSuffix(meta: TaskMeta): string {
    const parts: string[] = [];
    if (meta.id) { parts.push(`id:${meta.id}`); }
    if (meta.cd) { parts.push(`cd:${meta.cd}`); }
    if (meta.due) { parts.push(`due:${meta.due}`); }
    if (meta.dd) { parts.push(`dd:${meta.dd}`); }
    return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

function computeTaskNormalizationEdits(document: vscode.TextDocument, dateFormat: DateFormatOption): vscode.TextEdit[] {
    const edits: vscode.TextEdit[] = [];
    const existingIds = new Set<string>();

    // Pre-scan for existing ids to avoid duplicates when generating new ones.
    for (let i = 0; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text;
        const m = lineText.match(/\bid:([a-z0-9]{3,})\b/i);
        if (m?.[1]) {
            existingIds.add(m[1].toLowerCase());
        }
    }

    const sourceDateFromFilename = path.basename(document.fileName, '.md');
    const ddToday = formatDate(new Date(), dateFormat);

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const match = line.text.match(TASK_LINE_REGEX);
        if (!match) {
            continue;
        }

        const prefix = match[1]; // includes indentation + "- [ ] " etc.
        const completed = match[2].toLowerCase() === 'x';
        const priority = match[3] || null;
        const body = match[4] ?? '';

        const { cleanedText, meta } = stripAndCollectMeta(body);

        // Skip blank placeholder tasks (e.g. "- [ ]") to avoid generating ids for empty items.
        if (cleanedText.length === 0) {
            continue;
        }

        if (!meta.id) {
            meta.id = generateShortId(existingIds);
        }

        if (!meta.cd) {
            meta.cd = sourceDateFromFilename;
        }

        if (completed) {
            if (!meta.dd) {
                meta.dd = ddToday;
            }
        } else if (meta.dd) {
            delete meta.dd;
        }

        const priorityPrefix = priority ? `(${priority}) ` : '';
        const normalized = `${prefix}${priorityPrefix}${cleanedText}${buildMetaSuffix(meta)}`;

        if (normalized !== line.text) {
            edits.push(vscode.TextEdit.replace(line.range, normalized));
        }
    }

    return edits;
}

// ---------------------------------------------------------------------------
// Daily Notes Tree View
// ---------------------------------------------------------------------------

class DailyNotesProvider implements vscode.TreeDataProvider<DailyNote> {
    private _onDidChangeTreeData: vscode.EventEmitter<DailyNote | undefined | null | void> = new vscode.EventEmitter<DailyNote | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<DailyNote | undefined | null | void> = this._onDidChangeTreeData.event;
    private hasShownDemoPromptThisSession = false;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    private async maybePromptDemoOnFirstOpen(): Promise<void> {
        if (this.hasShownDemoPromptThisSession) {
            return;
        }

        this.hasShownDemoPromptThisSession = true;

        const runDemoOption = 'Run Demo Now';
        const askLaterOption = 'Later';
        const selection = await vscode.window.showInformationMessage(
            'Run the demo setup? This will create/append 2000-01-01.md with sample tasks so you can immediately demo the panel and todo generation.',
            runDemoOption,
            askLaterOption
        );

        if (selection === runDemoOption) {
            await vscode.commands.executeCommand('dailyNotes.generateSampleTodo');
        }
    }

    getTreeItem(element: DailyNote): vscode.TreeItem {
        if (element.fullPath === CONFIG_PLACEHOLDER_PATH) {
            const item = new vscode.TreeItem(element.filename, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('settings-gear');
            return item;
        }

        if (element.fullPath === DEMO_PLACEHOLDER_PATH) {
            const item = new vscode.TreeItem(element.filename, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('beaker');
            item.command = {
                command: 'dailyNotes.generateSampleTodo',
                title: 'Generate Sample Todo Data'
            };
            return item;
        }

        const treeItem = new vscode.TreeItem(path.basename(element.filename), vscode.TreeItemCollapsibleState.None);

        if (isToday(element.date)) {
            treeItem.iconPath = new vscode.ThemeIcon('star');
        }

        treeItem.command = {
            command: 'dailyNotes.openNote',
            title: 'Open Daily Note',
            arguments: [element.filename]
        };

        return treeItem;
    }

    async getChildren(): Promise<DailyNote[]> {
        const config = vscode.workspace.getConfiguration('dailyNotes');
        const notesFolder = config.get<string>('folder', '');
        const dateFormat = config.get<string>('dateFormat', 'yyyy-mm-dd') as DateFormatOption;

        if (!notesFolder) {
            vscode.window.showInformationMessage('Please configure the daily notes folder in settings');
            const placeholderNote: DailyNote = {
                filename: 'No folder found. Please configure the daily notes folder in settings.',
                fullPath: CONFIG_PLACEHOLDER_PATH,
                date: new Date('2000-01-01')
            };
            return [placeholderNote];
        }

        const folderPath = path.join(getWorkspaceRootPath(), notesFolder);

        try {
            const files = await fs.promises.readdir(folderPath);
            const notes = processNoteFiles(files, dateFormat, folderPath);
            if (notes.length === 0) {
                void this.maybePromptDemoOnFirstOpen();
                const placeholderNote: DailyNote = {
                    filename: 'No daily notes yet. Click here to generate demo data.',
                    fullPath: DEMO_PLACEHOLDER_PATH,
                    date: new Date('2000-01-01')
                };
                return [placeholderNote];
            }

            return notes;
        } catch (err) {
            vscode.window.showErrorMessage(`Error reading daily notes: ${err}`);
            return [];
        }
    }
}

// ---------------------------------------------------------------------------
// Todo Tree View — shows open tasks grouped by project
// ---------------------------------------------------------------------------

type TodoNode =
    | { kind: 'project'; name: string }
    | { kind: 'task'; task: Task }
    | { kind: 'empty'; message: string };

class TodoTreeProvider implements vscode.TreeDataProvider<TodoNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TodoNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private tasksByProject = new Map<string, Task[]>();

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TodoNode): vscode.TreeItem {
        if (element.kind === 'empty') {
            const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('info');
            return item;
        }

        if (element.kind === 'project') {
            const count = this.tasksByProject.get(element.name)?.length ?? 0;
            const label = element.name === 'Ungrouped' ? element.name : `+${element.name}`;
            const item = new vscode.TreeItem(`${label} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
            item.iconPath = new vscode.ThemeIcon('project');
            return item;
        }

        const t = element.task;
        const priority = t.priority ? `(${t.priority}) ` : '';
        const id = t.id ? ` id:${t.id}` : '';
        const label = `${priority}${t.text}${id}`;
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.description = t.sourceDate;
        item.tooltip = `${t.sourceFile}\nPriority: ${t.priority ?? 'none'}\nID: ${t.id ?? 'none'}\nCreated: ${t.cd ?? 'none'}\nDue: ${t.due ?? 'none'}\nDone: ${t.dd ?? 'none'}\nProjects: ${t.projects.join(', ') || 'none'}\nContexts: ${t.contexts.join(', ') || 'none'}`;

        if (t.priority === 'A') {
            item.iconPath = new vscode.ThemeIcon('flame');
        } else if (t.completed) {
            item.iconPath = new vscode.ThemeIcon('check');
        } else {
            item.iconPath = new vscode.ThemeIcon('circle-large-outline');
        }

        item.command = {
            command: 'dailyNotes.openNote',
            title: 'Open Source Note',
            arguments: [t.sourceFile]
        };

        return item;
    }

    async getChildren(element?: TodoNode): Promise<TodoNode[]> {
        if (element?.kind === 'project') {
            const tasks = this.tasksByProject.get(element.name) ?? [];
            return sortTasksByPriority(tasks).map(task => ({ kind: 'task' as const, task }));
        }

        if (element?.kind === 'empty') {
            return [];
        }

        // Root level — scan all daily notes and return project nodes
        const tasks = await scanAllTasks();
        const open = getUncompletedTasks(tasks);
        this.tasksByProject = groupTasksByProject(open);

        const keys = [...this.tasksByProject.keys()].sort((a, b) => {
            if (a === 'Ungrouped') { return 1; }
            if (b === 'Ungrouped') { return -1; }
            return a.localeCompare(b);
        });

        if (keys.length === 0) {
            const cfg = getNotesFolder();
            if (!cfg) {
                return [{ kind: 'empty' as const, message: 'Configure dailyNotes.folder to see tasks.' }];
            }
            return [{ kind: 'empty' as const, message: 'No open tasks found. Add tasks to a daily note or run the demo command.' }];
        }

        return keys.map(name => ({ kind: 'project' as const, name }));
    }
}

// ---------------------------------------------------------------------------
// Calendar View — webview month grid (TreeView can't render a calendar grid)
// ---------------------------------------------------------------------------

type CalendarCell = {
    day: number;
    inMonth: boolean;
    dateLabel: string;
    exists: boolean;
    isToday: boolean;
};

type CalendarModel = {
    title: string;
    year: number;
    monthIndex: number;
    dateFormat: DateFormatOption;
    weeks: CalendarCell[][];
};

class CalendarWebviewProvider implements vscode.WebviewViewProvider {
    private view: vscode.WebviewView | undefined;
    private currentMonth: Date;
    private webviewReady = false;
    private pendingPayload: unknown | null = null;

    constructor(private context: vscode.ExtensionContext) {
        const now = new Date();
        this.currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    setToToday(): void {
        const now = new Date();
        this.currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        void this.postModel();
    }

    shiftMonth(delta: number): void {
        this.currentMonth = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth() + delta, 1);
        void this.postModel();
    }

    refresh(): void {
        void this.postModel();
    }

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        this.webviewReady = false;

        webviewView.webview.options = {
            enableScripts: true,
        };

        webviewView.webview.html = this.renderHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            const type = message?.type;
            if (type === 'ready') {
                this.webviewReady = true;
                if (this.pendingPayload) {
                    await this.view?.webview.postMessage(this.pendingPayload);
                    this.pendingPayload = null;
                } else {
                    await this.postModel();
                }
                return;
            }
            if (type === 'prevMonth') {
                this.shiftMonth(-1);
                return;
            }
            if (type === 'nextMonth') {
                this.shiftMonth(1);
                return;
            }
            if (type === 'today') {
                this.setToToday();
                const cfg = getNotesFolder();
                if (cfg) {
                    const today = formatToday(cfg.dateFormat);
                    await openOrCreateDailyNoteForDate(today);
                }
                return;
            }
            if (type === 'create') {
                await vscode.commands.executeCommand('dailyNotes.openNoteForDate');
                return;
            }
            if (type === 'openDate' && typeof message?.dateLabel === 'string') {
                await openOrCreateDailyNoteForDate(message.dateLabel);
                return;
            }
        }, undefined, this.context.subscriptions);

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                void this.postModel();
            }
        }, undefined, this.context.subscriptions);

        void this.postModel();
    }

    private getExistingDateLabels(cfg: { folderPath: string; dateFormat: DateFormatOption }): Set<string> {
        const existing = new Set<string>();
        const dateRegex = getDateRegex(cfg.dateFormat);
        if (!dateRegex) {
            return existing;
        }

        let files: string[] = [];
        try {
            files = fs.readdirSync(cfg.folderPath);
        } catch {
            return existing;
        }

        for (const f of files) {
            if (!dateRegex.test(f)) {
                continue;
            }
            existing.add(f.replace(/\.md$/i, ''));
        }
        return existing;
    }

    private buildModel(cfg: { folderPath: string; dateFormat: DateFormatOption }): CalendarModel {
        const year = this.currentMonth.getFullYear();
        const monthIndex = this.currentMonth.getMonth();
        const monthTitle = this.currentMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' });
        const existing = this.getExistingDateLabels(cfg);

        const firstOfMonth = new Date(year, monthIndex, 1);
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

        // Monday-first grid: 0..6 where 0=Mon, 6=Sun
        const jsDay = firstOfMonth.getDay(); // 0=Sun..6=Sat
        const firstDow = (jsDay + 6) % 7;

        const weeks: CalendarCell[][] = [];
        let week: CalendarCell[] = [];

        const pushCell = (date: Date, inMonth: boolean) => {
            const dateLabel = formatDate(date, cfg.dateFormat);
            week.push({
                day: date.getDate(),
                inMonth,
                dateLabel,
                exists: existing.has(dateLabel),
                isToday: isToday(date),
            });
            if (week.length === 7) {
                weeks.push(week);
                week = [];
            }
        };

        // Leading days from previous month
        for (let i = 0; i < firstDow; i++) {
            const d = new Date(year, monthIndex, 1 - (firstDow - i));
            pushCell(d, false);
        }

        // Current month days
        for (let day = 1; day <= daysInMonth; day++) {
            const d = new Date(year, monthIndex, day);
            pushCell(d, true);
        }

        // Trailing days to fill last week
        if (week.length > 0) {
            const remaining = 7 - week.length;
            const lastDay = new Date(year, monthIndex, daysInMonth);
            for (let i = 1; i <= remaining; i++) {
                pushCell(new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + i), false);
            }
        }

        return { title: monthTitle, year, monthIndex, dateFormat: cfg.dateFormat, weeks };
    }

    private async postModel(): Promise<void> {
        if (!this.view) {
            return;
        }

        if (!this.webviewReady) {
            // Webview messages posted before the script loads can be dropped; queue the next payload.
            const cfg = getNotesFolder();
            this.pendingPayload = cfg
                ? { type: 'model', model: this.buildModel(cfg) }
                : { type: 'empty', message: 'Configure dailyNotes.folder to use the calendar.' };
            return;
        }

        const cfg = getNotesFolder();
        if (!cfg) {
            await this.view.webview.postMessage({ type: 'empty', message: 'Configure dailyNotes.folder to use the calendar.' });
            return;
        }

        await this.view.webview.postMessage({ type: 'model', model: this.buildModel(cfg) });
    }

    private renderHtml(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;

        return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --fg: var(--vscode-foreground);
      --muted: color-mix(in srgb, var(--vscode-foreground) 55%, transparent);
      --border: color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
      --bg: var(--vscode-sideBar-background);
      --accent: var(--vscode-textLink-foreground);
      --today: color-mix(in srgb, var(--vscode-button-background) 20%, transparent);
      --exists: color-mix(in srgb, var(--vscode-textLink-foreground) 85%, transparent);
    }
    body {
      margin: 0;
      padding: 6px;
      color: var(--fg);
      background: var(--bg);
      font: 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      gap: 8px;
    }
    .title {
      font-weight: 650;
      font-size: 14px;
      letter-spacing: 0.2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .actions {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-shrink: 0;
    }
    button {
      border: 1px solid var(--border);
      background: transparent;
      color: var(--fg);
      padding: 4px 8px;
      border-radius: 6px;
      cursor: pointer;
    }
    button:hover {
      border-color: color-mix(in srgb, var(--border) 70%, var(--accent));
    }
    .grid {
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
    }
    .dow {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      background: color-mix(in srgb, var(--bg) 80%, var(--border));
      border-bottom: 1px solid var(--border);
    }
    .dow div {
      padding: 6px 0;
      text-align: center;
      color: var(--muted);
      font-weight: 600;
      letter-spacing: 0.2px;
      font-size: 11px;
    }
    .weeks {
      display: grid;
      grid-template-rows: repeat(6, minmax(36px, 1fr));
    }
    .week {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      border-bottom: 1px solid var(--border);
    }
    .week:last-child { border-bottom: 0; }
    .cell {
      position: relative;
      padding: 6px 6px 4px 6px;
      border-right: 1px solid var(--border);
      cursor: pointer;
      user-select: none;
    }
    .cell:last-child { border-right: 0; }
    .cell:hover { background: color-mix(in srgb, var(--bg) 70%, var(--border)); }
    .cell.out { color: var(--muted); }
    .cell.today { background: var(--today); }
    .daynum {
      font-size: 12px;
      font-weight: 650;
    }
    .marker {
      position: absolute;
      left: 6px;
      right: 6px;
      bottom: 2px;
      height: 2px;
      border-radius: 999px;
      background: var(--exists);
      opacity: 0.95;
    }
    .cell.today .marker { background: var(--accent); }
    .hint {
      margin-top: 10px;
      color: var(--muted);
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title" id="title">Calendar</div>
    <div class="actions">
      <button id="createBtn" title="Create/Open note for date">New</button>
      <button id="todayBtn" title="Go to today">Today</button>
      <button id="prevBtn" title="Previous month">&#8592;</button>
      <button id="nextBtn" title="Next month">&#8594;</button>
    </div>
  </div>

  <div class="grid">
    <div class="dow">
      <div>MON</div><div>TUE</div><div>WED</div><div>THU</div><div>FRI</div><div>SAT</div><div>SUN</div>
    </div>
    <div id="weeks"></div>
  </div>

  <div class="hint">Click a day to open/create its note. An underline means the note exists.</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const titleEl = document.getElementById('title');
    const weeksEl = document.getElementById('weeks');

    document.getElementById('prevBtn').addEventListener('click', () => vscode.postMessage({ type: 'prevMonth' }));
    document.getElementById('nextBtn').addEventListener('click', () => vscode.postMessage({ type: 'nextMonth' }));
    document.getElementById('todayBtn').addEventListener('click', () => vscode.postMessage({ type: 'today' }));
    document.getElementById('createBtn').addEventListener('click', () => vscode.postMessage({ type: 'create' }));

    function render(model) {
      titleEl.textContent = model.title;
      weeksEl.innerHTML = '';

      for (const week of model.weeks) {
        const row = document.createElement('div');
        row.className = 'week';

        for (const cell of week) {
          const el = document.createElement('div');
          el.className = 'cell' + (cell.inMonth ? '' : ' out') + (cell.isToday ? ' today' : '');
          el.title = cell.dateLabel;
          el.addEventListener('click', () => vscode.postMessage({ type: 'openDate', dateLabel: cell.dateLabel }));

          const day = document.createElement('div');
          day.className = 'daynum';
          day.textContent = String(cell.day);
          el.appendChild(day);

          if (cell.exists) {
            const marker = document.createElement('div');
            marker.className = 'marker';
            el.appendChild(marker);
          }

          row.appendChild(el);
        }

        weeksEl.appendChild(row);
      }
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'empty') {
        titleEl.textContent = 'Calendar';
        weeksEl.innerHTML = '<div style="padding:10px;color:var(--muted)">' + msg.message + '</div>';
        return;
      }
      if (msg.type === 'model') {
        render(msg.model);
      }
    });

    // Signal to extension that the script is ready to receive messages.
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
    }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getWorkspaceRootPath(): string {
    // `rootPath` is deprecated and can be empty in multi-root workspaces.
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
}

function getNotesFolder(): { folderPath: string; dateFormat: DateFormatOption } | null {
    const config = vscode.workspace.getConfiguration('dailyNotes');
    const notesFolder = config.get<string>('folder', '');
    const dateFormat = config.get<string>('dateFormat', 'yyyy-mm-dd') as DateFormatOption;
    const rootPath = getWorkspaceRootPath();

    if (!notesFolder || !rootPath) {
        return null;
    }

    return {
        folderPath: path.join(rootPath, notesFolder),
        dateFormat,
    };
}

async function scanAllTasks(): Promise<Task[]> {
    const cfg = getNotesFolder();
    if (!cfg) {
        return [];
    }

    const { folderPath, dateFormat } = cfg;

    let files: string[];
    try {
        files = await fs.promises.readdir(folderPath);
    } catch {
        return [];
    }

    const notes = processNoteFiles(files, dateFormat, folderPath);
    const allTasks: Task[] = [];

    for (const note of notes) {
        try {
            const content = await fs.promises.readFile(note.fullPath, 'utf8');
            const dateString = note.filename.replace('.md', '');
            const tasks = parseTasksFromContent(content, dateString, note.filename);
            allTasks.push(...tasks);
        } catch {
            // skip unreadable files
        }
    }

    return allTasks;
}

/**
 * Finds uncompleted tasks from the most recent daily note before today.
 */
async function getTasksToRollover(folderPath: string, dateFormat: DateFormatOption, todayFilename: string): Promise<Task[]> {
    let files: string[];
    try {
        files = await fs.promises.readdir(folderPath);
    } catch {
        return [];
    }

    const notes = processNoteFiles(files, dateFormat, folderPath)
        .filter(n => n.filename !== todayFilename);

    if (notes.length === 0) {
        return [];
    }

    // notes are already sorted newest-first; take the most recent
    const mostRecent = notes[0];
    try {
        const content = await fs.promises.readFile(mostRecent.fullPath, 'utf8');
        const dateString = mostRecent.filename.replace('.md', '');
        const tasks = parseTasksFromContent(content, dateString, mostRecent.filename);
        return getUncompletedTasks(tasks);
    } catch {
        return [];
    }
}

function isAutoSaveEnabled(): boolean {
    return vscode.workspace.getConfiguration('dailyNotes').get<boolean>('autoSaveEnabled', false);
}

function isDailyNoteDocument(document: vscode.TextDocument, folderPath: string, dateFormat: DateFormatOption): boolean {
    if (document.languageId !== 'markdown') {
        return false;
    }

    const dateRegex = getDateRegex(dateFormat);
    if (!dateRegex) {
        return false;
    }

    const documentPath = path.resolve(document.fileName);
    const normalizedFolderPath = `${path.resolve(folderPath)}${path.sep}`;
    const filename = path.basename(document.fileName);

    return documentPath.startsWith(normalizedFolderPath) && dateRegex.test(filename);
}

async function writeTodoFile(openAfterWrite: boolean): Promise<{ totalTasks: number; todoPath: string | null }> {
    const cfg = getNotesFolder();
    if (!cfg) {
        return { totalTasks: 0, todoPath: null };
    }

    const tasks = await scanAllTasks();
    if (tasks.length === 0) {
        return { totalTasks: 0, todoPath: null };
    }

    const content = formatTodoMd(tasks);
    const todoPath = path.join(cfg.folderPath, 'todo.md');
    await fs.promises.writeFile(todoPath, content, 'utf8');

    if (openAfterWrite) {
        const document = await vscode.workspace.openTextDocument(todoPath);
        await vscode.window.showTextDocument(document, { preview: false });
    }

    return { totalTasks: tasks.length, todoPath };
}

async function processUpdatedTodosFromDocument(document: vscode.TextDocument, todoTreeProvider: TodoTreeProvider): Promise<void> {
    const cfg = getNotesFolder();
    if (!cfg || !isDailyNoteDocument(document, cfg.folderPath, cfg.dateFormat)) {
        return;
    }

    const sourceFile = path.basename(document.fileName);
    const sourceDate = sourceFile.replace('.md', '');
    parseTasksFromContent(document.getText(), sourceDate, sourceFile);

    await writeTodoFile(false);
    todoTreeProvider.refresh();
}

async function normalizeDailyNoteMetadata(
    document: vscode.TextDocument,
    cfg: { folderPath: string; dateFormat: DateFormatOption },
    normalizingDocuments: Set<string>
): Promise<boolean> {
    const uri = document.uri.toString();
    if (normalizingDocuments.has(uri)) {
        return false;
    }

    const edits = computeTaskNormalizationEdits(document, cfg.dateFormat);
    if (edits.length === 0) {
        return false;
    }

    normalizingDocuments.add(uri);
    try {
        const edit = new vscode.WorkspaceEdit();
        for (const e of edits) {
            edit.replace(document.uri, e.range, e.newText);
        }
        await vscode.workspace.applyEdit(edit);
        await document.save();
        return true;
    } finally {
        normalizingDocuments.delete(uri);
    }
}

function buildNewSampleNoteContent(): string {
    return `${SAMPLE_NOTE_HEADER}\n\n${SAMPLE_NOTE_INTRO}\n\n## Tasks\n\n${SAMPLE_TASKS.join('\n')}\n\n## Notes\n\n`;
}

function buildSampleAppendBlock(): string {
    return `\n---\n\n## Sample Tasks (Generated)\n\n${SAMPLE_NOTE_INTRO}\n\n${SAMPLE_TASKS.join('\n')}\n`;
}

async function createOrAppendSampleNote(folderPath: string): Promise<{ filePath: string; action: 'created' | 'appended' }> {
    const filePath = path.join(folderPath, SAMPLE_NOTE_FILENAME);
    const fileExists = fs.existsSync(filePath);

    if (!fileExists) {
        await fs.promises.writeFile(filePath, buildNewSampleNoteContent(), 'utf8');
        return { filePath, action: 'created' };
    }

    const existingContent = await fs.promises.readFile(filePath, 'utf8');
    const separator = existingContent.endsWith('\n') ? '\n' : '\n\n';
    await fs.promises.writeFile(filePath, `${existingContent}${separator}${buildSampleAppendBlock()}`, 'utf8');
    return { filePath, action: 'appended' };
}

async function autoSaveDirtyDocuments(autoSavedDocuments: Set<string>): Promise<void> {
    const dirtyDocuments = vscode.workspace.textDocuments.filter(doc => doc.isDirty && !doc.isUntitled);

    for (const document of dirtyDocuments) {
        const uri = document.uri.toString();
        autoSavedDocuments.add(uri);

        const didSave = await document.save();
        if (!didSave) {
            autoSavedDocuments.delete(uri);
        }
    }
}

function validateAndNormalizeDateInput(input: string, dateFormat: DateFormatOption): string | null {
    const trimmed = input.trim();
    if (dateFormat === 'yyyymmdd') {
        if (!/^\d{8}$/.test(trimmed)) {
            return null;
        }
        const d = parseDateFromFilename(trimmed, dateFormat);
        if (isNaN(d.getTime())) {
            return null;
        }
        return formatDate(d, dateFormat);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return null;
    }
    const d = parseDateFromFilename(trimmed, dateFormat);
    if (isNaN(d.getTime())) {
        return null;
    }
    return formatDate(d, dateFormat);
}

async function openOrCreateDailyNoteForDate(dateLabel: string): Promise<void> {
    const cfg = getNotesFolder();
    if (!cfg) {
        vscode.window.showErrorMessage('Please configure the daily notes folder in settings.');
        return;
    }

    await fs.promises.mkdir(cfg.folderPath, { recursive: true });

    const filePath = path.join(cfg.folderPath, `${dateLabel}.md`);
    if (!fs.existsSync(filePath)) {
        const template = `# Daily Note - ${dateLabel}\n\n## Tasks\n\n- [ ] \n\n## Notes\n\n`;
        await fs.promises.writeFile(filePath, template, 'utf8');
    }

    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document, { preview: false });
}

// ---------------------------------------------------------------------------
// Extension activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
    const dailyNotesProvider = new DailyNotesProvider(context);
    vscode.window.registerTreeDataProvider('dailyNotes', dailyNotesProvider);

    const calendarProvider = new CalendarWebviewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('calendarView', calendarProvider));

    const todoTreeProvider = new TodoTreeProvider();
    vscode.window.registerTreeDataProvider('todoView', todoTreeProvider);
    const autoSavedDocuments = new Set<string>();
    const normalizingDocuments = new Set<string>();
    let typingCooldownUntilMs = 0;
    let autoSaveInterval: NodeJS.Timeout | undefined;
    let previousActiveEditorUri = vscode.window.activeTextEditor?.document.uri.toString();

    const refreshAllViews = () => {
        dailyNotesProvider.refresh();
        calendarProvider.refresh();
        todoTreeProvider.refresh();
    };

    const setupAutoSave = () => {
        if (autoSaveInterval) {
            clearInterval(autoSaveInterval);
            autoSaveInterval = undefined;
        }

        if (!isAutoSaveEnabled()) {
            return;
        }

        autoSaveInterval = setInterval(() => {
            if (Date.now() < typingCooldownUntilMs) {
                return;
            }
            void autoSaveDirtyDocuments(autoSavedDocuments);
        }, 10000);
    };

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.isUntitled) {
                return;
            }
            // Pause autosave while the user is actively typing; resume after 5s of inactivity.
            typingCooldownUntilMs = Date.now() + 5000;
        })
    );

    context.subscriptions.push({
        dispose: () => {
            if (autoSaveInterval) {
                clearInterval(autoSaveInterval);
            }
        }
    });

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration('dailyNotes.autoSaveEnabled')) {
                return;
            }

            setupAutoSave();
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            const currentUri = editor?.document.uri.toString();

            if (isAutoSaveEnabled() && previousActiveEditorUri && previousActiveEditorUri !== currentUri) {
                if (Date.now() < typingCooldownUntilMs) {
                    previousActiveEditorUri = currentUri;
                    return;
                }
                const previousDocument = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === previousActiveEditorUri);
                if (previousDocument?.isDirty && !previousDocument.isUntitled) {
                    const uri = previousDocument.uri.toString();
                    autoSavedDocuments.add(uri);
                    const didSave = await previousDocument.save();
                    if (!didSave) {
                        autoSavedDocuments.delete(uri);
                    }
                }
            }

            previousActiveEditorUri = currentUri;
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            const cfg = getNotesFolder();
            if (cfg && isDailyNoteDocument(document, cfg.folderPath, cfg.dateFormat)) {
                const changed = await normalizeDailyNoteMetadata(document, cfg, normalizingDocuments);
                if (changed) {
                    // The save above will trigger processing again; avoid double-work here.
                    return;
                }

                await processUpdatedTodosFromDocument(document, todoTreeProvider);
            }

            const uri = document.uri.toString();
            if (!autoSavedDocuments.has(uri)) {
                return;
            }

            autoSavedDocuments.delete(uri);
            await processUpdatedTodosFromDocument(document, todoTreeProvider);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument((event) => {
            const cfg = getNotesFolder();
            if (!cfg || !isDailyNoteDocument(event.document, cfg.folderPath, cfg.dateFormat)) {
                return;
            }

            const edits = computeTaskNormalizationEdits(event.document, cfg.dateFormat);
            if (edits.length === 0) {
                return;
            }

            event.waitUntil(Promise.resolve(edits));
        })
    );

    setupAutoSave();

    // Refresh daily notes view
    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.refresh', () => {
            refreshAllViews();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.focusDailyNotes', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.dailyNotesContainer');
            try { await vscode.commands.executeCommand('dailyNotes.focus'); } catch {}
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.focusCalendar', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.dailyNotesContainer');
            try { await vscode.commands.executeCommand('calendarView.focus'); } catch {}
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.focusTodo', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.dailyNotesContainer');
            try { await vscode.commands.executeCommand('todoView.focus'); } catch {}
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.calendarToday', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.dailyNotesContainer');
            try { await vscode.commands.executeCommand('calendarView.focus'); } catch {}

            const cfg = getNotesFolder();
            if (!cfg) {
                return;
            }

            const today = formatToday(cfg.dateFormat);
            calendarProvider.setToToday();
            await openOrCreateDailyNoteForDate(today);
            refreshAllViews();
        })
    );

    // Open or create a daily note (with task rollover)
    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.openNote', async (filename?: string) => {
            try {
                const dateFormat = (vscode.workspace.getConfiguration().get<string>('dailyNotes.dateFormat') || 'yyyy-mm-dd') as DateFormatOption;

                const notesDir = getWorkspaceRootPath();
                if (!notesDir) {
                    vscode.window.showErrorMessage('Workspace folder is not set.');
                    return;
                }

                const notesFolder = vscode.workspace.getConfiguration().get<string>('dailyNotes.folder') || '';
                const folderPath = path.join(notesDir, notesFolder);

                if (!fs.existsSync(folderPath)) {
                    fs.mkdirSync(folderPath, { recursive: true });
                }

                let filePath: string;
                if (filename) {
                    filePath = path.join(folderPath, filename);
                } else {
                    const today = formatToday(dateFormat);
                    const todayFile = `${today}.md`;
                    filePath = path.join(folderPath, todayFile);

                    if (!fs.existsSync(filePath)) {
                        // Rollover uncompleted tasks from the previous note
                        const rollovers = await getTasksToRollover(folderPath, dateFormat, todayFile);
                        const rolloverSection = buildRolloverSection(rollovers);

                        const template = `# Daily Note - ${today}\n\n## Tasks\n\n${rolloverSection}- [ ] \n\n## Notes\n\n`;
                        fs.writeFileSync(filePath, template, 'utf8');
                    }
                }

                const document = await vscode.workspace.openTextDocument(filePath);
                await vscode.window.showTextDocument(document, { preview: false });

                refreshAllViews();

            } catch (error) {
                console.error('Error in openNote command:', error);
                vscode.window.showErrorMessage(`Failed to open daily note: ${error}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.openNoteForDate', async (dateArg?: string) => {
            try {
                const cfg = getNotesFolder();
                if (!cfg) {
                    vscode.window.showErrorMessage('Please configure the daily notes folder in settings.');
                    return;
                }

                let dateLabel: string | null = null;
                if (typeof dateArg === 'string' && dateArg.trim().length > 0) {
                    dateLabel = validateAndNormalizeDateInput(dateArg, cfg.dateFormat);
                } else {
                    const prompt = cfg.dateFormat === 'yyyymmdd' ? 'Enter date (yyyymmdd)' : 'Enter date (yyyy-mm-dd)';
                    const input = await vscode.window.showInputBox({ prompt, placeHolder: cfg.dateFormat === 'yyyymmdd' ? '20260214' : '2026-02-14' });
                    if (!input) {
                        return;
                    }
                    dateLabel = validateAndNormalizeDateInput(input, cfg.dateFormat);
                }

                if (!dateLabel) {
                    vscode.window.showErrorMessage('Invalid date format.');
                    return;
                }

                await openOrCreateDailyNoteForDate(dateLabel);
                refreshAllViews();
            } catch (error) {
                console.error('Error in openNoteForDate command:', error);
                vscode.window.showErrorMessage(`Failed to open daily note: ${error}`);
            }
        })
    );

    // Insert title from filename
    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.addTitle', async () => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('No active editor');
                    return;
                }

                const document = editor.document;
                const basename = path.basename(document.fileName, '.md');
                const title = filenameToTitle(basename);

                const position = editor.selection.active;

                const edit = new vscode.WorkspaceEdit();
                edit.insert(document.uri, position, `# ${title}\n\n`);

                await vscode.workspace.applyEdit(edit);
            } catch (error) {
                console.error('Error in addTitle command:', error);
                vscode.window.showErrorMessage(`Failed to add title: ${error}`);
            }
        })
    );

    // Generate todo.md from all daily notes
    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.generateTodo', async () => {
            try {
                if (!getNotesFolder()) {
                    vscode.window.showErrorMessage('Please configure the daily notes folder in settings.');
                    return;
                }

                const result = await writeTodoFile(true);
                if (result.totalTasks === 0) {
                    vscode.window.showInformationMessage('No tasks found in daily notes.');
                    return;
                }

                vscode.window.showInformationMessage(`Generated todo.md with ${result.totalTasks} tasks.`);
            } catch (error) {
                console.error('Error in generateTodo command:', error);
                vscode.window.showErrorMessage(`Failed to generate todo.md: ${error}`);
            }
        })
    );

    // Generate a sample note + sample tasks for demoing todo parsing.
    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.generateSampleTodo', async () => {
            try {
                const cfg = getNotesFolder();
                if (!cfg) {
                    vscode.window.showErrorMessage('Please configure the daily notes folder in settings.');
                    return;
                }

                await fs.promises.mkdir(cfg.folderPath, { recursive: true });
                const result = await createOrAppendSampleNote(cfg.folderPath);

                const document = await vscode.workspace.openTextDocument(result.filePath);
                await vscode.window.showTextDocument(document, { preview: false });

                const edits = computeTaskNormalizationEdits(document, cfg.dateFormat);
                if (edits.length > 0) {
                    const edit = new vscode.WorkspaceEdit();
                    for (const e of edits) {
                        edit.replace(document.uri, e.range, e.newText);
                    }
                    await vscode.workspace.applyEdit(edit);
                    await document.save();
                }

                await processUpdatedTodosFromDocument(document, todoTreeProvider);
                dailyNotesProvider.refresh();

                const actionText = result.action === 'created' ? 'Created' : 'Appended sample tasks in';
                vscode.window.showInformationMessage(`${actionText} ${SAMPLE_NOTE_FILENAME}.`);
            } catch (error) {
                console.error('Error in generateSampleTodo command:', error);
                vscode.window.showErrorMessage(`Failed to generate sample todo: ${error}`);
            }
        })
    );
}

export function deactivate() {}
