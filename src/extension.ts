import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import moment from 'moment';

interface DailyNote {
    filename: string;
    fullPath: string;
    date: Date;
}

class DailyNotesProvider implements vscode.TreeDataProvider<DailyNote> {
    private _onDidChangeTreeData: vscode.EventEmitter<DailyNote | undefined | null | void> = new vscode.EventEmitter<DailyNote | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<DailyNote | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DailyNote): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(path.basename(element.filename), vscode.TreeItemCollapsibleState.None);
        
        // Highlight today's note
        const today = new Date();
        if (moment(element.date).isSame(today, 'day')) {
            treeItem.iconPath = new vscode.ThemeIcon('star');
        }

        treeItem.command = {
            command: 'dailyNotes.openNote',
            title: 'Open Daily Note',
            arguments: [element]
        };

        return treeItem;
    }

    async getChildren(): Promise<DailyNote[]> {
        // Get configuration
        const config = vscode.workspace.getConfiguration('dailyNotes');
        const notesFolder = config.get<string>('folder', '');
        const dateFormat = config.get<string>('dateFormat', 'YYYY-MM-DD');

        // Validate notes folder
        if (!notesFolder) {
            vscode.window.showInformationMessage('Please configure the daily notes folder in settings');
            return [];
        }

        const folderPath = path.join(vscode.workspace.rootPath || '', notesFolder);

        // Define the regular expression to match filenames based on the date format
        let dateRegex: RegExp;
        if (dateFormat === 'yyyymmdd') {
            dateRegex = /^\d{8}\.md$/;
        } else if (dateFormat === 'yyyy-mm-dd') {
            dateRegex = /^\d{4}-\d{2}-\d{2}\.md$/;
        } else {
            vscode.window.showErrorMessage(`Unsupported date format: ${dateFormat}`);
            return [];
        }

        // Read and process daily notes
        try {
            const files = await fs.promises.readdir(folderPath);
            console.log(`Files in folder: ${files.join(', ')}`);
            
            const dailyNotes: DailyNote[] = files
                .filter(file => dateRegex.test(file))
                .map(filename => {
                    console.log(`Processing file: ${filename}`);
                    const fullPath = path.join(folderPath, filename);
                    const dateString = filename.replace('.md', '');
                    const date = moment(dateString, dateFormat === 'yyyymmdd' ? 'YYYYMMDD' : 'YYYY-MM-DD').toDate();
                    console.log(`Parsed date: ${date}`);

                    return {
                        filename,
                        fullPath,
                        date
                    };
                })
                .filter(note => {
                    const isValidDate = !isNaN(note.date.getTime());
                    console.log(`File: ${note.filename}, Valid date: ${isValidDate}`);
                    return isValidDate;
                })
                .sort((a, b) => b.date.getTime() - a.date.getTime());

            console.log(`Filtered notes: ${dailyNotes.map(note => note.filename).join(', ')}`);
            return dailyNotes;
        } catch (err) {
            vscode.window.showErrorMessage(`Error reading daily notes: ${err}`);
            return [];
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    // Register the Daily Notes View Provider
    const dailyNotesProvider = new DailyNotesProvider(context);
    vscode.window.registerTreeDataProvider('dailyNotes', dailyNotesProvider);

    // Command to refresh the daily notes view
    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.refresh', () => {
            dailyNotesProvider.refresh();
        })
    );

    // Command to open today's daily note
    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.openNote', async () => {
            try {
                const dateFormat = vscode.workspace.getConfiguration().get<string>('dailyNotes.dateFormat') || 'yyyy-MM-dd';
                console.log(`Date format from config: ${dateFormat}`);

                const notesDir = vscode.workspace.rootPath || '';
                console.log(`Notes directory: ${notesDir}`);

                if (!notesDir) {
                    vscode.window.showErrorMessage('Workspace folder is not set.');
                    return;
                }

                const notesFolder = vscode.workspace.getConfiguration().get<string>('dailyNotes.folder') || '';
                const folderPath = path.join(notesDir, notesFolder);
                console.log(`Full folder path: ${folderPath}`);

                if (!fs.existsSync(folderPath)) {
                    console.log(`Creating folder: ${folderPath}`);
                    fs.mkdirSync(folderPath, { recursive: true });
                }

                const today = moment().format(dateFormat === 'yyyymmdd' ? 'YYYYMMDD' : 'YYYY-MM-DD');
                console.log(`Today's date formatted: ${today}`);
                
                const todayFile = `${today}.md`;
                const todayFilePath = path.join(folderPath, todayFile);
                console.log(`Today's file path: ${todayFilePath}`);

                if (!fs.existsSync(todayFilePath)) {
                    console.log(`Creating new daily note: ${todayFilePath}`);
                    const template = `# Daily Note - ${today}\n\n## Tasks\n\n- [ ] \n\n## Notes\n\n`;
                    fs.writeFileSync(todayFilePath, template, 'utf8');
                    console.log('File created successfully');
                } else {
                    console.log('Daily note already exists');
                }

                console.log('Opening document...');
                const document = await vscode.workspace.openTextDocument(todayFilePath);
                console.log('Showing text document...');
                await vscode.window.showTextDocument(document);
                console.log('Document opened successfully');
            } catch (error) {
                console.error('Error in openNote command:', error);
                vscode.window.showErrorMessage(`Failed to open daily note: ${error}`);
            }
        })
    );

    // Add this to your activate function
    context.subscriptions.push(
        vscode.commands.registerCommand('dailyNotes.addTitle', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            const document = editor.document;
            const filename = path.basename(document.fileName, '.md');
            
            // Convert filename to title
            const title = filename
                .split(/[-_]/)
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');

            // Create edit to insert title at start of document
            const edit = new vscode.WorkspaceEdit();
            edit.insert(document.uri, new vscode.Position(0, 0), `# ${title}\n\n`);

            await vscode.workspace.applyEdit(edit);
        })
    );
}

export function deactivate() {}