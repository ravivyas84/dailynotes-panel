import {
    parseTaskLine,
    parseTasksFromContent,
    getUncompletedTasks,
    sortTasksByPriority,
    groupTasksByProject,
    formatTaskLine,
    formatTodoMd,
    buildRolloverSection,
    Task,
} from '../taskParser';

// ---------------------------------------------------------------------------
// parseTaskLine
// ---------------------------------------------------------------------------
describe('parseTaskLine', () => {
    const date = '2025-02-09';
    const file = '2025-02-09.md';

    it('parses a basic uncompleted task', () => {
        const task = parseTaskLine('- [ ] Buy groceries', date, file);
        expect(task).not.toBeNull();
        expect(task!.completed).toBe(false);
        expect(task!.priority).toBeNull();
        expect(task!.text).toBe('Buy groceries');
        expect(task!.projects).toEqual([]);
        expect(task!.contexts).toEqual([]);
    });

    it('parses a completed task', () => {
        const task = parseTaskLine('- [x] Buy groceries', date, file);
        expect(task!.completed).toBe(true);
    });

    it('parses uppercase X as completed', () => {
        const task = parseTaskLine('- [X] Buy groceries', date, file);
        expect(task!.completed).toBe(true);
    });

    it('parses priority', () => {
        const task = parseTaskLine('- [ ] (A) Fix critical bug', date, file);
        expect(task!.priority).toBe('A');
        expect(task!.text).toBe('Fix critical bug');
    });

    it('parses project tags', () => {
        const task = parseTaskLine('- [ ] Submit PR +Backend +API', date, file);
        expect(task!.projects).toEqual(['Backend', 'API']);
    });

    it('parses context tags', () => {
        const task = parseTaskLine('- [ ] Call client @phone @work', date, file);
        expect(task!.contexts).toEqual(['phone', 'work']);
    });

    it('parses full todo.txt-style line', () => {
        const task = parseTaskLine('- [ ] (B) Review PR for auth +Backend @work', date, file);
        expect(task!.completed).toBe(false);
        expect(task!.priority).toBe('B');
        expect(task!.text).toBe('Review PR for auth +Backend @work');
        expect(task!.projects).toEqual(['Backend']);
        expect(task!.contexts).toEqual(['work']);
        expect(task!.sourceDate).toBe(date);
        expect(task!.sourceFile).toBe(file);
    });

    it('preserves the raw line', () => {
        const line = '- [ ] (A) Do something +Proj @ctx';
        const task = parseTaskLine(line, date, file);
        expect(task!.rawLine).toBe(line);
    });

    it('returns null for non-task lines', () => {
        expect(parseTaskLine('## Tasks', date, file)).toBeNull();
        expect(parseTaskLine('Some plain text', date, file)).toBeNull();
        expect(parseTaskLine('', date, file)).toBeNull();
        expect(parseTaskLine('- not a checkbox', date, file)).toBeNull();
    });

    it('returns null for headings and blank lines', () => {
        expect(parseTaskLine('# Daily Note', date, file)).toBeNull();
        expect(parseTaskLine('   ', date, file)).toBeNull();
    });

    it('handles leading whitespace (indented tasks)', () => {
        const task = parseTaskLine('  - [ ] Indented task', date, file);
        expect(task).not.toBeNull();
        expect(task!.text).toBe('Indented task');
    });
});

// ---------------------------------------------------------------------------
// parseTasksFromContent
// ---------------------------------------------------------------------------
describe('parseTasksFromContent', () => {
    it('extracts tasks from a full daily note', () => {
        const content = [
            '# Daily Note - 2025-02-09',
            '',
            '## Tasks',
            '',
            '- [ ] (A) Fix login bug +Backend @work',
            '- [x] (B) Review design +UI @work',
            '- [ ] Buy milk',
            '',
            '## Notes',
            '',
            'Had a productive day.',
        ].join('\n');

        const tasks = parseTasksFromContent(content, '2025-02-09', '2025-02-09.md');
        expect(tasks).toHaveLength(3);
        expect(tasks[0].priority).toBe('A');
        expect(tasks[1].completed).toBe(true);
        expect(tasks[2].text).toBe('Buy milk');
    });

    it('returns empty array for note with no tasks', () => {
        const content = '# Daily Note\n\n## Notes\n\nJust notes today.';
        expect(parseTasksFromContent(content, '2025-02-09', '2025-02-09.md')).toHaveLength(0);
    });

    it('returns empty array for empty content', () => {
        expect(parseTasksFromContent('', '2025-02-09', '2025-02-09.md')).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// getUncompletedTasks
// ---------------------------------------------------------------------------
describe('getUncompletedTasks', () => {
    const tasks: Task[] = [
        { completed: false, priority: 'A', text: 'Open task', projects: [], contexts: [], sourceDate: '2025-02-09', sourceFile: '2025-02-09.md', rawLine: '' },
        { completed: true, priority: 'B', text: 'Done task', projects: [], contexts: [], sourceDate: '2025-02-09', sourceFile: '2025-02-09.md', rawLine: '' },
        { completed: false, priority: null, text: 'Another open', projects: [], contexts: [], sourceDate: '2025-02-09', sourceFile: '2025-02-09.md', rawLine: '' },
    ];

    it('filters out completed tasks', () => {
        const result = getUncompletedTasks(tasks);
        expect(result).toHaveLength(2);
        expect(result.every(t => !t.completed)).toBe(true);
    });

    it('returns empty array when all tasks are completed', () => {
        const allDone = tasks.map(t => ({ ...t, completed: true }));
        expect(getUncompletedTasks(allDone)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// sortTasksByPriority
// ---------------------------------------------------------------------------
describe('sortTasksByPriority', () => {
    it('sorts A before B before C before null', () => {
        const tasks: Task[] = [
            { completed: false, priority: 'C', text: 'C task', projects: [], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
            { completed: false, priority: null, text: 'No prio', projects: [], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
            { completed: false, priority: 'A', text: 'A task', projects: [], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
            { completed: false, priority: 'B', text: 'B task', projects: [], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
        ];
        const sorted = sortTasksByPriority(tasks);
        expect(sorted.map(t => t.priority)).toEqual(['A', 'B', 'C', null]);
    });

    it('does not mutate the original array', () => {
        const tasks: Task[] = [
            { completed: false, priority: 'B', text: 'B', projects: [], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
            { completed: false, priority: 'A', text: 'A', projects: [], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
        ];
        sortTasksByPriority(tasks);
        expect(tasks[0].priority).toBe('B');
    });
});

// ---------------------------------------------------------------------------
// groupTasksByProject
// ---------------------------------------------------------------------------
describe('groupTasksByProject', () => {
    it('groups tasks by project', () => {
        const tasks: Task[] = [
            { completed: false, priority: null, text: 'T1 +Alpha', projects: ['Alpha'], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
            { completed: false, priority: null, text: 'T2 +Beta', projects: ['Beta'], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
            { completed: false, priority: null, text: 'T3 +Alpha', projects: ['Alpha'], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
        ];
        const groups = groupTasksByProject(tasks);
        expect(groups.get('Alpha')).toHaveLength(2);
        expect(groups.get('Beta')).toHaveLength(1);
    });

    it('puts projectless tasks under "Ungrouped"', () => {
        const tasks: Task[] = [
            { completed: false, priority: null, text: 'No project', projects: [], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
        ];
        const groups = groupTasksByProject(tasks);
        expect(groups.get('Ungrouped')).toHaveLength(1);
    });

    it('lists multi-project tasks under each project', () => {
        const tasks: Task[] = [
            { completed: false, priority: null, text: 'Shared +Alpha +Beta', projects: ['Alpha', 'Beta'], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
        ];
        const groups = groupTasksByProject(tasks);
        expect(groups.get('Alpha')).toHaveLength(1);
        expect(groups.get('Beta')).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// formatTaskLine
// ---------------------------------------------------------------------------
describe('formatTaskLine', () => {
    const base: Task = {
        completed: false,
        priority: null,
        text: 'Do something',
        projects: [],
        contexts: [],
        sourceDate: '2025-02-09',
        sourceFile: '2025-02-09.md',
        rawLine: '',
    };

    it('formats an uncompleted task', () => {
        expect(formatTaskLine(base)).toBe('- [ ] Do something');
    });

    it('formats a completed task', () => {
        expect(formatTaskLine({ ...base, completed: true })).toBe('- [x] Do something');
    });

    it('includes priority', () => {
        expect(formatTaskLine({ ...base, priority: 'A' })).toBe('- [ ] (A) Do something');
    });

    it('includes date when requested', () => {
        expect(formatTaskLine(base, true)).toBe('- [ ] Do something — 2025-02-09');
    });

    it('includes both priority and date', () => {
        expect(formatTaskLine({ ...base, priority: 'B' }, true)).toBe('- [ ] (B) Do something — 2025-02-09');
    });
});

// ---------------------------------------------------------------------------
// formatTodoMd
// ---------------------------------------------------------------------------
describe('formatTodoMd', () => {
    it('generates grouped markdown with dates', () => {
        const tasks: Task[] = [
            { completed: false, priority: 'A', text: 'Fix bug +Backend @work', projects: ['Backend'], contexts: ['work'], sourceDate: '2025-02-09', sourceFile: '', rawLine: '' },
            { completed: true, priority: 'B', text: 'Design review +UI', projects: ['UI'], contexts: [], sourceDate: '2025-02-08', sourceFile: '', rawLine: '' },
            { completed: false, priority: null, text: 'Buy milk', projects: [], contexts: [], sourceDate: '2025-02-07', sourceFile: '', rawLine: '' },
        ];

        const md = formatTodoMd(tasks);

        expect(md).toContain('# Tasks');
        expect(md).toContain('## +Backend');
        expect(md).toContain('## +UI');
        expect(md).toContain('## Ungrouped');
        expect(md).toContain('- [ ] (A) Fix bug +Backend @work — 2025-02-09');
        expect(md).toContain('- [x] (B) Design review +UI — 2025-02-08');
        expect(md).toContain('- [ ] Buy milk — 2025-02-07');
    });

    it('puts Ungrouped last', () => {
        const tasks: Task[] = [
            { completed: false, priority: null, text: 'No project', projects: [], contexts: [], sourceDate: '2025-02-09', sourceFile: '', rawLine: '' },
            { completed: false, priority: null, text: 'Has project +Alpha', projects: ['Alpha'], contexts: [], sourceDate: '2025-02-09', sourceFile: '', rawLine: '' },
        ];

        const md = formatTodoMd(tasks);
        const alphaIdx = md.indexOf('## +Alpha');
        const ungroupedIdx = md.indexOf('## Ungrouped');
        expect(alphaIdx).toBeLessThan(ungroupedIdx);
    });

    it('sorts tasks by priority within groups', () => {
        const tasks: Task[] = [
            { completed: false, priority: 'C', text: 'C task +Proj', projects: ['Proj'], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
            { completed: false, priority: 'A', text: 'A task +Proj', projects: ['Proj'], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
        ];
        const md = formatTodoMd(tasks);
        const aIdx = md.indexOf('A task');
        const cIdx = md.indexOf('C task');
        expect(aIdx).toBeLessThan(cIdx);
    });
});

// ---------------------------------------------------------------------------
// buildRolloverSection
// ---------------------------------------------------------------------------
describe('buildRolloverSection', () => {
    it('returns empty string when no tasks', () => {
        expect(buildRolloverSection([])).toBe('');
    });

    it('formats uncompleted tasks as markdown checkboxes', () => {
        const tasks: Task[] = [
            { completed: false, priority: 'A', text: 'Important thing', projects: [], contexts: [], sourceDate: '2025-02-08', sourceFile: '', rawLine: '' },
            { completed: false, priority: null, text: 'Less important', projects: [], contexts: [], sourceDate: '2025-02-08', sourceFile: '', rawLine: '' },
        ];
        const section = buildRolloverSection(tasks);
        expect(section).toContain('- [ ] (A) Important thing');
        expect(section).toContain('- [ ] Less important');
    });

    it('sorts by priority', () => {
        const tasks: Task[] = [
            { completed: false, priority: 'C', text: 'C', projects: [], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
            { completed: false, priority: 'A', text: 'A', projects: [], contexts: [], sourceDate: '', sourceFile: '', rawLine: '' },
        ];
        const section = buildRolloverSection(tasks);
        const aIdx = section.indexOf('(A)');
        const cIdx = section.indexOf('(C)');
        expect(aIdx).toBeLessThan(cIdx);
    });
});
