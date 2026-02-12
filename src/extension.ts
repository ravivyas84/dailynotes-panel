import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DailyNote, DateFormatOption, getDateRegex, isToday, formatToday, filenameToTitle, processNoteFiles } from './utils';
import { Task, parseTasksFromContent, getUncompletedTasks, groupTasksByProject, sortTasksByPriority, formatTodoMd, formatTaskLine, buildRolloverSection } from './taskParser';

const SAMPLE_NOTE_FILENAME = '2000-01-01.md';
const SAMPLE_NOTE_HEADER = '# Daily Note - 2000-01-01';
const SAMPLE_NOTE_INTRO = 'This is a sample note.';
const CONFIG_PLACEHOLDER_PATH = '__CONFIG_PLACEHOLDER__';
const DEMO_PLACEHOLDER_PATH = '__DEMO_PLACEHOLDER__';
const SAMPLE_TASKS = [
    '- [ ] (A) Fix critical login bug +Backend @work',
    '- [ ] (A) Draft weekly roadmap +Planning @work',
    '- [ ] (B) Review UI spacing updates +UI +Web @work',
    '- [ ] (B) Follow up with vendor about invoices +Finance @office',
    '- [ ] (C) Write release notes for the sprint +Docs @work',
    '- [x] (C) Update dependency versions +Backend',
    '- [ ] Buy groceries @home',
    '- [ ] Plan weekend trip +Personal @phone',
];

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

        const folderPath = path.join(vscode.workspace.rootPath || '', notesFolder);

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

type TodoNode = { kind: 'project'; name: string } | { kind: 'task'; task: Task };

class TodoTreeProvider implements vscode.TreeDataProvider<TodoNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TodoNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private tasksByProject = new Map<string, Task[]>();

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TodoNode): vscode.TreeItem {
        if (element.kind === 'project') {
            const count = this.tasksByProject.get(element.name)?.length ?? 0;
            const label = element.name === 'Ungrouped' ? element.name : `+${element.name}`;
            const item = new vscode.TreeItem(`${label} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
            item.iconPath = new vscode.ThemeIcon('project');
            return item;
        }

        const t = element.task;
        const checkbox = t.completed ? '$(check)' : '$(circle-large-outline)';
        const priority = t.priority ? `(${t.priority}) ` : '';
        const label = `${checkbox} ${priority}${t.text}`;
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.description = t.sourceDate;
        item.tooltip = `${t.sourceFile}\nPriority: ${t.priority ?? 'none'}\nProjects: ${t.projects.join(', ') || 'none'}\nContexts: ${t.contexts.join(', ') || 'none'}`;

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
            return [];
        }

        return keys.map(name => ({ kind: 'project' as const, name }));
    }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getNotesFolder(): { folderPath: string; dateFormat: DateFormatOption } | null {
    const config = vscode.workspace.getConfiguration('dailyNotes');
    const notesFolder = config.get<string>('folder', '');
    const dateFormat = config.get<string>('dateFormat', 'yyyy-mm-dd') as DateFormatOption;
    const rootPath = vscode.workspace.rootPath || '';

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

// ---------------------------------------------------------------------------
// Extension activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
    const dailyNotesProvider = new DailyNotesProvider(context);
    vscode.window.registerTreeDataProvider('dailyNotes', dailyNotesProvider);

    const todoTreeProvider = new TodoTreeProvider();
    vscode.window.registerTreeDataProvider('todoView', todoTreeProvider);
    const autoSavedDocuments = new Set<string>();
    let autoSaveInterval: NodeJS.Timeout | undefined;
    let previousActiveEditorUri = vscode.window.activeTextEditor?.document.uri.toString();

    const refreshAllViews = () => {
        dailyNotesProvider.refresh();
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
            void autoSaveDirtyDocuments(autoSavedDocuments);
        }, 10000);
    };

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
            const uri = document.uri.toString();
            if (!autoSavedDocuments.has(uri)) {
                return;
            }

            autoSavedDocuments.delete(uri);
            await processUpdatedTodosFromDocument(document, todoTreeProvider);
        })
    );

    setupAutoSave();

    // Refresh daily notes view
    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.refresh', () => {
            refreshAllViews();
        })
    );

    // Open or create a daily note (with task rollover)
    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.openNote', async (filename?: string) => {
            try {
                const dateFormat = (vscode.workspace.getConfiguration().get<string>('dailyNotes.dateFormat') || 'yyyy-mm-dd') as DateFormatOption;

                const notesDir = vscode.workspace.rootPath || '';
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
