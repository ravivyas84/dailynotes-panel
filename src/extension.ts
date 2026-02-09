import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DailyNote, DateFormatOption, isToday, formatToday, filenameToTitle, processNoteFiles } from './utils';
import { Task, parseTasksFromContent, getUncompletedTasks, groupTasksByProject, sortTasksByPriority, formatTodoMd, formatTaskLine, buildRolloverSection } from './taskParser';

// ---------------------------------------------------------------------------
// Daily Notes Tree View
// ---------------------------------------------------------------------------

class DailyNotesProvider implements vscode.TreeDataProvider<DailyNote> {
    private _onDidChangeTreeData: vscode.EventEmitter<DailyNote | undefined | null | void> = new vscode.EventEmitter<DailyNote | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<DailyNote | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DailyNote): vscode.TreeItem {
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
                fullPath: '',
                date: new Date('2000-01-01')
            };
            return [placeholderNote];
        }

        const folderPath = path.join(vscode.workspace.rootPath || '', notesFolder);

        try {
            const files = await fs.promises.readdir(folderPath);
            return processNoteFiles(files, dateFormat, folderPath);
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

// ---------------------------------------------------------------------------
// Extension activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
    const dailyNotesProvider = new DailyNotesProvider(context);
    vscode.window.registerTreeDataProvider('dailyNotes', dailyNotesProvider);

    const todoTreeProvider = new TodoTreeProvider();
    vscode.window.registerTreeDataProvider('todoView', todoTreeProvider);

    // Refresh daily notes view
    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.refresh', () => {
            dailyNotesProvider.refresh();
            todoTreeProvider.refresh();
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

                dailyNotesProvider.refresh();
                todoTreeProvider.refresh();

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
                const cfg = getNotesFolder();
                if (!cfg) {
                    vscode.window.showErrorMessage('Please configure the daily notes folder in settings.');
                    return;
                }

                const tasks = await scanAllTasks();
                if (tasks.length === 0) {
                    vscode.window.showInformationMessage('No tasks found in daily notes.');
                    return;
                }

                const content = formatTodoMd(tasks);
                const todoPath = path.join(cfg.folderPath, 'todo.md');
                fs.writeFileSync(todoPath, content, 'utf8');

                const document = await vscode.workspace.openTextDocument(todoPath);
                await vscode.window.showTextDocument(document, { preview: false });

                vscode.window.showInformationMessage(`Generated todo.md with ${tasks.length} tasks.`);
            } catch (error) {
                console.error('Error in generateTodo command:', error);
                vscode.window.showErrorMessage(`Failed to generate todo.md: ${error}`);
            }
        })
    );
}

export function deactivate() {}
