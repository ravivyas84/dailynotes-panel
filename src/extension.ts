import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DailyNote, DateFormatOption, isToday, formatToday, filenameToTitle, processNoteFiles } from './utils';

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

export function activate(context: vscode.ExtensionContext) {
    const dailyNotesProvider = new DailyNotesProvider(context);
    vscode.window.registerTreeDataProvider('dailyNotes', dailyNotesProvider);

    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.refresh', () => {
            dailyNotesProvider.refresh();
        })
    );

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
                        const template = `# Daily Note - ${today}\n\n## Tasks\n\n- [ ] \n\n## Notes\n\n`;
                        fs.writeFileSync(filePath, template, 'utf8');
                    }
                }

                const document = await vscode.workspace.openTextDocument(filePath);
                await vscode.window.showTextDocument(document, { preview: false });

                dailyNotesProvider.refresh();

            } catch (error) {
                console.error('Error in openNote command:', error);
                vscode.window.showErrorMessage(`Failed to open daily note: ${error}`);
            }
        })
    );

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
}

export function deactivate() {}
