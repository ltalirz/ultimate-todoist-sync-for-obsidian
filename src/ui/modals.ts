import { App, Modal, Notice, Setting, TextComponent } from "obsidian";
import UltimateTodoistSyncForObsidian from "../../main";


// ==========================================================================================
// SetDefalutProjectInTheFilepathModal - 设置文件默认项目
// ==========================================================================================

interface MyProject {
	id: string;
	name: string;
}

export class SetDefalutProjectInTheFilepathModal extends Modal {
  defaultProjectId: string
  defaultProjectName: string
  filepath:string
  plugin:UltimateTodoistSyncForObsidian

    
  constructor(app: App,plugin:UltimateTodoistSyncForObsidian, filepath:string) {
    super(app);
    this.filepath = filepath
    this.plugin = plugin
    this.open()
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h5', { text: 'Set default project for todoist tasks in the current file' });

    this.defaultProjectId = await this.plugin.cacheOperation.getDefaultProjectIdForFilepath(this.filepath)
    const project = await this.plugin.todoistSyncAPI.getProjectById(this.defaultProjectId)
    this.defaultProjectName = project?.name ?? this.plugin.settings.defaultProjectName
    this.plugin.debugLog(this.defaultProjectId)
    this.plugin.debugLog(this.defaultProjectName)
    const projects = this.plugin.todoistSyncAPI.getSyncData()?.projects || []
    const myProjectsOptions: MyProject | undefined = projects.reduce((obj, item) => {
        obj[(item.id).toString()] = item.name;
        return obj;
        }, {}
    );
      
    

    new Setting(contentEl)
    .setName('Default project')
    //.setDesc('Set default project for todoist tasks in the current file')
    .addDropdown(component => 
        component
                .addOption(this.defaultProjectId,this.defaultProjectName)
                .addOptions(myProjectsOptions)
                .onChange((value)=>{
                    this.plugin.debugLog(`project id  is ${value}`)
                    this.plugin.cacheOperation.setDefaultProjectIdForFilepath(this.filepath,value)
                    this.plugin.setStatusBarText()
                    this.close();
                    
                })
                
        )


  

  }

  onClose() {
    let { contentEl } = this;
    contentEl.empty();
  }
}


// ==========================================================================================
// ConflictResolutionModal - 冲突解决弹窗
// ==========================================================================================

export interface TaskConflict {
    taskId: string;
    filePath: string;
    obsidianContent: string;
    todoistContent: string;
    lineNumber: number;
}

export type ConflictResolution = 'obsidian' | 'todoist' | 'skip';

export class ConflictResolutionModal extends Modal {
    plugin: UltimateTodoistSyncForObsidian;
    conflicts: TaskConflict[];
    currentIndex: number;
    resolutions: Map<string, ConflictResolution>;
    onComplete: (resolutions: Map<string, ConflictResolution>) => void;

    constructor(
        app: App,
        plugin: UltimateTodoistSyncForObsidian,
        conflicts: TaskConflict[],
        onComplete: (resolutions: Map<string, ConflictResolution>) => void
    ) {
        super(app);
        this.plugin = plugin;
        this.conflicts = conflicts;
        this.currentIndex = 0;
        this.resolutions = new Map();
        this.onComplete = onComplete;
        this.open();
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        if (this.conflicts.length === 0) {
            contentEl.createEl('h3', { text: 'No conflicts found!' });
            new Setting(contentEl).addButton(btn => btn.setButtonText('Close').onClick(() => this.close()));
            return;
        }

        this.renderConflict();
    }

    renderConflict() {
        const { contentEl } = this;
        contentEl.empty();

        const conflict = this.conflicts[this.currentIndex];
        const progress = `${this.currentIndex + 1} / ${this.conflicts.length}`;

        contentEl.createEl('h4', { text: `Task Conflict Resolution (${progress})` });
        contentEl.createEl('p', { text: `File: ${conflict.filePath}:${conflict.lineNumber}` });

        const container = contentEl.createDiv({ cls: 'conflict-container' });

        const obsidianSection = container.createDiv({ cls: 'conflict-section' });
        obsidianSection.createEl('h5', { text: 'Obsidian Version' });
        obsidianSection.createEl('pre', { 
            text: conflict.obsidianContent,
            cls: 'conflict-content' 
        });

        const todoistSection = container.createDiv({ cls: 'conflict-section' });
        todoistSection.createEl('h5', { text: 'Todoist Version' });
        todoistSection.createEl('pre', { 
            text: conflict.todoistContent,
            cls: 'conflict-content' 
        });

        const buttonContainer = contentEl.createDiv({ cls: 'conflict-buttons' });

        new Setting(buttonContainer)
            .addButton(btn => 
                btn.setButtonText('Keep Obsidian')
                    .setCta()
                    .onClick(() => this.resolve('obsidian'))
            )
            .addButton(btn => 
                btn.setButtonText('Keep Todoist')
                    .setCta()
                    .onClick(() => this.resolve('todoist'))
            )
            .addButton(btn => 
                btn.setButtonText('Skip')
                    .onClick(() => this.resolve('skip'))
            );

        if (this.currentIndex < this.conflicts.length - 1) {
            new Setting(buttonContainer)
                .addButton(btn => 
                    btn.setButtonText('Skip All Remaining')
                        .onClick(() => {
                            for (let i = this.currentIndex; i < this.conflicts.length; i++) {
                                this.resolutions.set(this.conflicts[i].taskId, 'skip');
                            }
                            this.complete();
                        })
                );
        }
    }

    resolve(resolution: ConflictResolution) {
        const conflict = this.conflicts[this.currentIndex];
        this.resolutions.set(conflict.taskId, resolution);

        if (this.currentIndex < this.conflicts.length - 1) {
            this.currentIndex++;
            this.renderConflict();
        } else {
            this.complete();
        }
    }

    complete() {
        this.onComplete(this.resolutions);
        this.close();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}


// ==========================================================================================
// LogViewerModal - 日志查看器
// ==========================================================================================

export class LogViewerModal extends Modal {
    plugin: UltimateTodoistSyncForObsidian;
    private filterDirection: 'all' | 'obsidian→todoist' | 'todoist→obsidian' = 'all';
    private searchQuery = '';
    private logListEl: HTMLElement;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.style.width = '800px';
        modalEl.style.maxWidth = '90vw';

        contentEl.createEl('h4', { text: 'Sync Logs' });

        // Toolbar
        const toolbar = contentEl.createDiv({ cls: 'log-viewer-toolbar' });
        toolbar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;';

        // Search
        const searchInput = toolbar.createEl('input', {
            type: 'text',
            placeholder: 'Search logs…',
        }) as HTMLInputElement;
        searchInput.style.cssText = 'flex:1;min-width:160px;padding:4px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);';
        searchInput.addEventListener('input', () => {
            this.searchQuery = searchInput.value.toLowerCase();
            this.renderLogs();
        });

        // Direction filter
        const filterSelect = toolbar.createEl('select') as HTMLSelectElement;
        filterSelect.style.cssText = 'padding:4px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);';
        [['all', 'All directions'], ['obsidian→todoist', 'obsidian → todoist'], ['todoist→obsidian', 'todoist → obsidian']]
            .forEach(([val, label]) => {
                const opt = filterSelect.createEl('option', { text: label });
                opt.value = val;
            });
        filterSelect.addEventListener('change', () => {
            this.filterDirection = filterSelect.value as typeof this.filterDirection;
            this.renderLogs();
        });

        // Clear button
        const clearBtn = toolbar.createEl('button', { text: 'Clear Logs' });
        clearBtn.style.cssText = 'padding:4px 10px;border-radius:4px;cursor:pointer;background:var(--interactive-normal);color:var(--text-normal);border:1px solid var(--background-modifier-border);';
        clearBtn.addEventListener('click', () => {
            this.plugin.logOperation?.clearLogs();
            this.renderLogs();
        });

        // Log list container
        this.logListEl = contentEl.createDiv({ cls: 'log-viewer-list' });
        this.logListEl.style.cssText = 'height:500px;overflow-y:auto;font-family:var(--font-monospace);font-size:12px;border:1px solid var(--background-modifier-border);border-radius:4px;padding:8px;background:var(--background-secondary);';

        this.renderLogs();
    }

    private renderLogs() {
        const logs = this.plugin.logOperation?.getLogs() || [];
        this.logListEl.empty();

        const filtered = logs.filter(entry => {
            if (this.filterDirection !== 'all' && entry.direction !== this.filterDirection) return false;
            if (this.searchQuery) {
                const haystack = `${entry.action} ${entry.details} ${entry.filePath || ''} ${entry.taskId || ''}`.toLowerCase();
                if (!haystack.includes(this.searchQuery)) return false;
            }
            return true;
        }).reverse(); // newest first

        if (filtered.length === 0) {
            this.logListEl.createEl('p', { text: 'No logs match the current filter.', cls: 'log-empty' });
            (this.logListEl.querySelector('.log-empty') as HTMLElement).style.cssText = 'color:var(--text-muted);text-align:center;margin-top:40px;';
            return;
        }

        for (const entry of filtered) {
            const row = this.logListEl.createDiv({ cls: 'log-row' });
            row.style.cssText = 'display:flex;gap:8px;align-items:baseline;padding:3px 0;border-bottom:1px solid var(--background-modifier-border-hover);';

            // Timestamp
            const ts = row.createSpan();
            ts.style.cssText = 'color:var(--text-muted);white-space:nowrap;flex-shrink:0;';
            ts.textContent = new Date(entry.timestamp).toLocaleString();

            // Direction badge
            if (entry.direction) {
                const badge = row.createSpan({ text: entry.direction });
                const isToObsidian = entry.direction === 'todoist→obsidian';
                badge.style.cssText = `white-space:nowrap;flex-shrink:0;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600;background:${isToObsidian ? 'var(--color-green)' : 'var(--color-blue)'};color:#fff;opacity:0.85;`;
            }

            // Action
            const action = row.createSpan({ text: entry.action });
            action.style.cssText = 'font-weight:600;color:var(--text-accent);white-space:nowrap;flex-shrink:0;';

            // Details
            const details = row.createSpan({ text: entry.details });
            details.style.cssText = 'color:var(--text-normal);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
            details.title = entry.details; // full text on hover

            // Task ID
            if (entry.taskId) {
                const tid = row.createSpan({ text: entry.taskId });
                tid.style.cssText = 'color:var(--text-muted);font-size:11px;white-space:nowrap;flex-shrink:0;';
            }
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}


// ==========================================================================================
// TaskManagerModal - 问题任务管理器
// ==========================================================================================

export class TaskManagerModal extends Modal {
    plugin: UltimateTodoistSyncForObsidian;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        super(app);
        this.plugin = plugin;
    }

    async onOpen() {
        const { modalEl } = this;
        modalEl.style.width = '900px';
        modalEl.style.maxWidth = '95vw';
        await this.loadAndRender();
    }

    private async loadAndRender() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: 'Task Manager' });

        const scrollArea = contentEl.createDiv();
        scrollArea.style.cssText = 'max-height: 70vh; overflow-y: auto;';

        const mapping = this.plugin.settings.taskFileMapping;
        const conflicted: string[] = [];
        const issue: string[] = [];
        const nonActive: string[] = [];

        for (const [taskId, info] of Object.entries(mapping)) {
            if (info.status === 'conflicted') conflicted.push(taskId);
            else if (info.status === 'issue') issue.push(taskId);
            else if (info.status === 'nonActive') nonActive.push(taskId);
        }

        await this.renderConflictedSection(scrollArea, conflicted);
        await this.renderIssueSection(scrollArea, issue);
        await this.renderNonActiveSection(scrollArea, nonActive);

        if (conflicted.length === 0 && issue.length === 0 && nonActive.length === 0) {
            scrollArea.createEl('p', { text: 'No problem tasks found.' }).style.cssText = 'color: var(--text-muted); text-align: center; margin-top: 40px;';
        }
    }

    private async renderConflictedSection(container: HTMLElement, taskIds: string[]) {
        if (taskIds.length === 0) return;

        const header = container.createEl('h4', { text: `\u26a0\ufe0f Conflicted Tasks (${taskIds.length})` });
        header.style.cssText = 'margin-top: 16px;';

        for (const taskId of taskIds) {
            const info = this.plugin.settings.taskFileMapping[taskId];
            const filePath = info?.filePath || '';

            const card = container.createDiv();
            card.style.cssText = 'border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 12px; margin-bottom: 12px;';

            // Card header
            const cardHeader = card.createDiv();
            cardHeader.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;';
            cardHeader.createSpan({ text: `ID: ${taskId}` }).style.cssText = 'font-family: var(--font-monospace); font-size: 12px; color: var(--text-muted);';

            const fileLink = cardHeader.createEl('a', { text: filePath });
            fileLink.style.cssText = 'color: var(--text-accent); cursor: pointer; font-size: 12px; text-decoration: underline;';
            fileLink.addEventListener('click', () => this.openFile(filePath));

            // Load data from both sides
            const line = await this.getTaskLine(taskId, filePath);
            let obsContent = '', obsStatus = '', obsDue = '', obsTags = '', obsPriority = '';
            let todContent = '', todStatus = '', todDue = '', todTags = '', todPriority = '';

            if (line) {
                obsContent = this.plugin.taskParser.getTaskContentFromLineText(line) || '';
                obsStatus = /\[(x|X)\]/.test(line) ? '\u2611' : '\u2610';
                obsDue = this.plugin.taskParser.getDueDateFromLineText(line) || '';
                obsTags = this.plugin.taskParser.getAllTagsFromLineText(line).join(', ');
                obsPriority = `!!${this.plugin.taskParser.getTaskPriority(line)}`;
            }

            try {
                const task = await this.plugin.todoistSyncAPI.GetTaskById(taskId);
                if (task) {
                    todContent = task.content || '';
                    todStatus = task.checked ? '\u2611' : '\u2610';
                    todDue = task.due?.date || '';
                    todTags = (task.labels || []).join(', ');
                    todPriority = `!!${task.priority || 1}`;
                }
            } catch (e) {
                // task may not exist
            }

            // Diff table
            const table = card.createEl('table');
            table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 10px;';

            const thead = table.createEl('thead');
            const headerRow = thead.createEl('tr');
            for (const h of ['Field', 'Obsidian', 'Todoist']) {
                const th = headerRow.createEl('th', { text: h });
                th.style.cssText = 'text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--background-modifier-border); color: var(--text-muted); font-weight: 600;';
            }

            const tbody = table.createEl('tbody');
            const rows: [string, string, string][] = [
                ['Content', obsContent, todContent],
                ['Status', obsStatus, todStatus],
                ['Due Date', obsDue, todDue],
                ['Tags', obsTags, todTags],
                ['Priority', obsPriority, todPriority],
            ];

            for (const [field, obsVal, todVal] of rows) {
                const tr = tbody.createEl('tr');
                const isDiff = obsVal !== todVal;
                if (isDiff) {
                    tr.style.cssText = 'background: var(--background-modifier-error-hover); border-radius: 4px;';
                }
                const tdField = tr.createEl('td', { text: field });
                tdField.style.cssText = 'padding: 4px 8px; font-weight: 500; color: var(--text-muted); white-space: nowrap;';
                const tdObs = tr.createEl('td', { text: obsVal || '\u2014' });
                tdObs.style.cssText = 'padding: 4px 8px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
                tdObs.title = obsVal;
                const tdTod = tr.createEl('td', { text: todVal || '\u2014' });
                tdTod.style.cssText = 'padding: 4px 8px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
                tdTod.title = todVal;
            }

            // Buttons
            const btnRow = card.createDiv();
            btnRow.style.cssText = 'display: flex; gap: 8px;';

            const keepObsBtn = btnRow.createEl('button', { text: 'Keep Obsidian' });
            keepObsBtn.style.cssText = 'padding: 6px 14px; border-radius: 4px; cursor: pointer; background: var(--interactive-accent); color: var(--text-on-accent); border: none; font-weight: 600;';
            keepObsBtn.addEventListener('click', async () => {
                keepObsBtn.disabled = true;
                await this.resolveConflict(taskId, filePath, 'obsidian');
            });

            const keepTodBtn = btnRow.createEl('button', { text: 'Keep Todoist' });
            keepTodBtn.style.cssText = 'padding: 6px 14px; border-radius: 4px; cursor: pointer; background: var(--interactive-normal); color: var(--text-normal); border: 1px solid var(--background-modifier-border);';
            keepTodBtn.addEventListener('click', async () => {
                keepTodBtn.disabled = true;
                await this.resolveConflict(taskId, filePath, 'todoist');
            });
        }
    }

    private async renderIssueSection(container: HTMLElement, taskIds: string[]) {
        if (taskIds.length === 0) return;

        const header = container.createEl('h4', { text: `\u2757 Issue Tasks (${taskIds.length})` });
        header.style.cssText = 'margin-top: 16px;';

        const table = container.createEl('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 12px;';

        const thead = table.createEl('thead');
        const headerRow = thead.createEl('tr');
        for (const h of ['Task ID', 'File', 'Content', '']) {
            const th = headerRow.createEl('th', { text: h });
            th.style.cssText = 'text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--background-modifier-border); color: var(--text-muted); font-weight: 600;';
        }

        const tbody = table.createEl('tbody');
        for (const taskId of taskIds) {
            const info = this.plugin.settings.taskFileMapping[taskId];
            const filePath = info?.filePath || '';
            const line = await this.getTaskLine(taskId, filePath);
            const preview = line
                ? (this.plugin.taskParser.getTaskContentFromLineText(line) || line.substring(0, 60))
                : '(file not found)';

            const tr = tbody.createEl('tr');
            tr.style.cssText = 'border-bottom: 1px solid var(--background-modifier-border-hover);';

            const tdId = tr.createEl('td', { text: taskId });
            tdId.style.cssText = 'padding: 4px 8px; font-family: var(--font-monospace); font-size: 11px; color: var(--text-muted); white-space: nowrap;';

            const tdFile = tr.createEl('td');
            tdFile.style.cssText = 'padding: 4px 8px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
            const fileLink = tdFile.createEl('a', { text: filePath || '\u2014' });
            fileLink.style.cssText = 'color: var(--text-accent); cursor: pointer; text-decoration: underline;';
            fileLink.addEventListener('click', () => this.openFile(filePath));

            const tdContent = tr.createEl('td', { text: preview });
            tdContent.style.cssText = 'padding: 4px 8px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
            tdContent.title = preview;

            const tdBtn = tr.createEl('td');
            tdBtn.style.cssText = 'padding: 4px 8px; white-space: nowrap;';
            const delBtn = tdBtn.createEl('button', { text: 'Delete' });
            delBtn.style.cssText = 'padding: 4px 10px; border-radius: 4px; cursor: pointer; background: var(--background-modifier-error); color: var(--text-on-accent); border: none;';
            delBtn.addEventListener('click', async () => {
                delBtn.disabled = true;
                await this.deleteIssueTask(taskId);
            });
        }
    }

    private async renderNonActiveSection(container: HTMLElement, taskIds: string[]) {
        if (taskIds.length === 0) return;

        const header = container.createEl('h4', { text: `\ud83d\udccb NonActive Tasks (${taskIds.length})` });
        header.style.cssText = 'margin-top: 16px; color: var(--text-muted);';

        const table = container.createEl('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 12px;';

        const thead = table.createEl('thead');
        const headerRow = thead.createEl('tr');
        for (const h of ['Task ID', 'File', 'Content']) {
            const th = headerRow.createEl('th', { text: h });
            th.style.cssText = 'text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--background-modifier-border); color: var(--text-muted); font-weight: 600;';
        }

        const tbody = table.createEl('tbody');
        for (const taskId of taskIds) {
            const info = this.plugin.settings.taskFileMapping[taskId];
            const filePath = info?.filePath || '';
            const line = await this.getTaskLine(taskId, filePath);
            const preview = line
                ? (this.plugin.taskParser.getTaskContentFromLineText(line) || line.substring(0, 60))
                : '(file not found)';

            const tr = tbody.createEl('tr');
            tr.style.cssText = 'border-bottom: 1px solid var(--background-modifier-border-hover);';

            const tdId = tr.createEl('td', { text: taskId });
            tdId.style.cssText = 'padding: 4px 8px; font-family: var(--font-monospace); font-size: 11px; color: var(--text-muted); white-space: nowrap;';

            const tdFile = tr.createEl('td');
            tdFile.style.cssText = 'padding: 4px 8px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
            const fileLink = tdFile.createEl('a', { text: filePath || '\u2014' });
            fileLink.style.cssText = 'color: var(--text-accent); cursor: pointer; text-decoration: underline;';
            fileLink.addEventListener('click', () => this.openFile(filePath));

            const tdContent = tr.createEl('td', { text: preview });
            tdContent.style.cssText = 'padding: 4px 8px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
            tdContent.title = preview;
        }
    }

    private async resolveConflict(taskId: string, filePath: string, choice: 'obsidian' | 'todoist') {
        try {
            if (choice === 'obsidian') {
                const line = await this.getTaskLine(taskId, filePath);
                if (!line) { new Notice('Task line not found in vault'); return; }

                const content = this.plugin.taskParser.getTaskContentFromLineText(line);
                const labels = this.plugin.taskParser.getAllTagsFromLineText(line);
                const dueDate = this.plugin.taskParser.getDueDateFromLineText(line);
                const priority = this.plugin.taskParser.getTaskPriority(line);
                const isCompleted = /\[(x|X)\]/.test(line);

                const updates: Record<string, unknown> = {};
                if (content) updates.content = content;
                if (labels && labels.length > 0) updates.labels = labels;
                if (dueDate) updates.dueDate = dueDate;
                else updates.dueString = 'no date';
                updates.priority = priority;
                await this.plugin.todoistSyncAPI.UpdateTask(taskId, updates);

                // Sync completion status
                const savedTask = await this.plugin.todoistSyncAPI.GetTaskById(taskId);
                const todoistChecked = savedTask?.checked || false;
                if (isCompleted && !todoistChecked) {
                    await this.plugin.todoistSyncAPI.CloseTask(taskId);
                } else if (!isCompleted && todoistChecked) {
                    await this.plugin.todoistSyncAPI.OpenTask(taskId);
                }

                // Refresh and update mapping
                await this.plugin.todoistSyncAPI.incrementalSync();
                const refreshed = await this.plugin.todoistSyncAPI.GetTaskById(taskId);
                await this.plugin.cacheOperation.setTaskFileMapping(taskId, filePath, 'active', true);
                if (refreshed?.updated_at) {
                    await this.plugin.cacheOperation.updateTaskMappingSyncMeta(taskId, { updated_at: refreshed.updated_at });
                }
                this.plugin.saveSettings();
                new Notice(`Conflict resolved: kept Obsidian version for task ${taskId}`);

            } else {
                const task = await this.plugin.todoistSyncAPI.GetTaskById(taskId);
                if (!task) { new Notice('Task not found in Todoist'); return; }

                // Sync content
                if (task.content) {
                    await this.plugin.fileOperation.syncTaskContentToFile(taskId, task.content);
                }

                // Sync due date
                const todoistDueDate = task.due?.date || '';
                await this.plugin.fileOperation.syncTaskDueDateToFile(taskId, todoistDueDate);

                // Sync checked status
                const line = await this.getTaskLine(taskId, filePath);
                const obsidianChecked = line ? /\[(x|X)\]/.test(line) : false;
                const todoistChecked = task.checked || false;
                if (todoistChecked && !obsidianChecked) {
                    await this.plugin.fileOperation.completeTaskInTheFile(taskId);
                } else if (!todoistChecked && obsidianChecked) {
                    await this.plugin.fileOperation.uncompleteTaskInTheFile(taskId);
                }

                // Update mapping
                await this.plugin.cacheOperation.setTaskFileMapping(taskId, filePath, 'active', true);
                await this.plugin.cacheOperation.updateTaskMappingSyncMeta(taskId, { updated_at: task.updated_at });
                this.plugin.saveSettings();
                new Notice(`Conflict resolved: kept Todoist version for task ${taskId}`);
            }
        } catch (e) {
            console.error(`[TaskManagerModal] resolveConflict error:`, e);
            new Notice(`Error resolving conflict: ${e}`);
        }
        await this.loadAndRender();
    }

    private async deleteIssueTask(taskId: string) {
        try {
            // Try API delete (ignore errors — task likely already gone)
            try {
                await this.plugin.todoistSyncAPI.deleteTask(taskId);
            } catch (e) {
                // ignore — task probably doesn't exist in Todoist
            }

            // Unbind from vault file
            await this.plugin.fileOperation.unbindTaskInFile(taskId);

            // Remove mapping
            await this.plugin.cacheOperation.deleteTaskFileMapping(taskId);
            this.plugin.saveSettings();
            new Notice(`Issue task ${taskId} deleted`);
        } catch (e) {
            console.error(`[TaskManagerModal] deleteIssueTask error:`, e);
            new Notice(`Error deleting task: ${e}`);
        }
        await this.loadAndRender();
    }

    private openFile(filePath: string) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file) {
            this.app.workspace.getLeaf(false).openFile(file as any);
        }
    }

    private async getTaskLine(taskId: string, filePath: string): Promise<string | null> {
        try {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (!file) return null;
            const content = await this.app.vault.read(file as any);
            const lines = content.split('\n');
            for (const line of lines) {
                if (line.includes(taskId)) return line;
            }
        } catch (e) {
            // file may not exist
        }
        return null;
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
