export interface Task {
    completed: boolean;
    priority: string | null;
    text: string;
    id?: string;
    cd?: string;
    due?: string;
    dd?: string;
    projects: string[];
    contexts: string[];
    sourceDate: string;
    sourceFile: string;
    rawLine: string;
}

const TASK_REGEX = /^-\s+\[([ xX])\]\s*(?:\(([A-Z])\)\s+)?(.+)$/;
const PROJECT_TAG = /\+(\S+)/g;
const CONTEXT_TAG = /@(\S+)/g;
const META_TOKEN = /\b(id|cd|dd|due):([^\s]+)\b/gi;

function parseAndStripMetadata(text: string): { cleanedText: string; meta: Pick<Task, 'id' | 'cd' | 'dd' | 'due'> } {
    const meta: Pick<Task, 'id' | 'cd' | 'dd' | 'due'> = {};
    const cleanedText = text
        .replace(META_TOKEN, (_m, key: string, value: string) => {
            const k = String(key).toLowerCase();
            if (k === 'id') { meta.id = value; }
            if (k === 'cd') { meta.cd = value; }
            if (k === 'due') { meta.due = value; }
            if (k === 'dd') { meta.dd = value; }
            return '';
        })
        .replace(/\s+/g, ' ')
        .trim();

    // Reset global regex state for callers that might reuse META_TOKEN.
    META_TOKEN.lastIndex = 0;

    return { cleanedText, meta };
}

/**
 * Parses a single markdown checkbox line into a Task, or returns null if not a task.
 *
 * Supported format (todo.txt-inspired):
 *   - [ ] (A) Do something +Project @context
 *   - [x] (B) Done thing +Project @context
 */
export function parseTaskLine(line: string, sourceDate: string, sourceFile: string): Task | null {
    const match = line.trim().match(TASK_REGEX);
    if (!match) {
        return null;
    }

    const completed = match[1].toLowerCase() === 'x';
    const priority = match[2] || null;
    const originalText = match[3].trim();
    const { cleanedText: text, meta } = parseAndStripMetadata(originalText);

    const projects = extractTags(text, PROJECT_TAG);
    const contexts = extractTags(text, CONTEXT_TAG);

    return {
        completed,
        priority,
        text,
        ...meta,
        projects,
        contexts,
        sourceDate,
        sourceFile,
        rawLine: line.trim(),
    };
}

function extractTags(text: string, regex: RegExp): string[] {
    const tags: string[] = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
        tags.push(m[1]);
    }
    regex.lastIndex = 0;
    return tags;
}

/**
 * Parses all task lines from a daily note's content.
 */
export function parseTasksFromContent(content: string, sourceDate: string, sourceFile: string): Task[] {
    return content
        .split('\n')
        .map(line => parseTaskLine(line, sourceDate, sourceFile))
        .filter((t): t is Task => t !== null);
}

/**
 * Returns only uncompleted tasks.
 */
export function getUncompletedTasks(tasks: Task[]): Task[] {
    return tasks.filter(t => !t.completed);
}

/**
 * Sorts tasks by priority: (A) first, (B) second, ..., no priority last.
 * Within the same priority, preserves original order.
 */
export function sortTasksByPriority(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
        const pa = a.priority ?? 'ZZZ';
        const pb = b.priority ?? 'ZZZ';
        return pa.localeCompare(pb);
    });
}

/**
 * Groups tasks by project. Tasks with no project go under "Ungrouped".
 * Tasks with multiple projects appear under each project.
 */
export function groupTasksByProject(tasks: Task[]): Map<string, Task[]> {
    const groups = new Map<string, Task[]>();

    for (const task of tasks) {
        const keys = task.projects.length > 0 ? task.projects : ['Ungrouped'];
        for (const key of keys) {
            const group = groups.get(key) ?? [];
            group.push(task);
            groups.set(key, group);
        }
    }

    return groups;
}

/**
 * Formats a single task as a markdown checkbox line with source date.
 */
export function formatTaskLine(task: Task, includeDate: boolean = false): string {
    const checkbox = task.completed ? '[x]' : '[ ]';
    const priority = task.priority ? `(${task.priority}) ` : '';
    const date = includeDate ? ` — [[${task.sourceDate}]]` : '';
    const meta: string[] = [];
    if (task.id) { meta.push(`id:${task.id}`); }
    if (task.cd) { meta.push(`cd:${task.cd}`); }
    if (task.due) { meta.push(`due:${task.due}`); }
    if (task.dd) { meta.push(`dd:${task.dd}`); }

    const metaSuffix = meta.length > 0 ? ` ${meta.join(' ')}` : '';
    return `- ${checkbox} ${priority}${task.text}${metaSuffix}${date}`;
}

/**
 * Generates a full todo.md markdown document from tasks grouped by project.
 * Tasks are sorted by priority within each group.
 */
export function formatTodoMd(tasks: Task[]): string {
    const grouped = groupTasksByProject(tasks);
    const lines: string[] = [
        '<!-- GENERATED FILE: Do not edit by hand. Run \"dailyNotes: Generate todo.md from All Notes\". -->',
        '',
        '# Tasks',
        ''
    ];

    // Sort project names, but put "Ungrouped" last
    const keys = [...grouped.keys()].sort((a, b) => {
        if (a === 'Ungrouped') { return 1; }
        if (b === 'Ungrouped') { return -1; }
        return a.localeCompare(b);
    });

    for (const project of keys) {
        const projectTasks = sortTasksByPriority(grouped.get(project)!);
        const label = project === 'Ungrouped' ? project : `+${project}`;
        lines.push(`## ${label}`, '');
        for (const task of projectTasks) {
            lines.push(formatTaskLine(task, true));
        }
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Builds the rollover section for a new daily note template.
 * Takes uncompleted tasks from previous notes and formats them.
 */
export function buildRolloverSection(uncompletedTasks: Task[]): string {
    if (uncompletedTasks.length === 0) {
        return '';
    }

    const sorted = sortTasksByPriority(uncompletedTasks);
    const lines = sorted.map(task => formatTaskLine(task));
    return lines.join('\n') + '\n';
}
