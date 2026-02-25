import { App, Modal, Notice, Setting, TextComponent, TFile } from "obsidian";
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
				.onChange(async (value)=>{
					this.plugin.debugLog(`project id  is ${value}`)
					await this.plugin.cacheOperation.setDefaultProjectIdForFilepath(this.filepath,value)
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
// TaskManagerModal - 问题任务管理器 (Master-Detail Pattern)
// ==========================================================================================
export class TaskManagerModal extends Modal {
	plugin: UltimateTodoistSyncForObsidian;
	private _closed = false;
	private _fileCache = new Map<string, string>();
	private currentView: 'list' | 'detail' = 'list';
	private selectedTaskId: string | null = null;
	private taskData: { conflicted: string[], issue: string[], nonActive: string[] } = { conflicted: [], issue: [], nonActive: [] };
	private scrollArea: HTMLElement | null = null;
	private _activeOverlay: HTMLElement | null = null;
	constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
		super(app);
		this.plugin = plugin;
	}
	async onOpen() {
		const { modalEl } = this;
		modalEl.addClass('task-manager-modal');
		await this.loadAndRender();
	}
	private async loadAndRender() {
		const { contentEl } = this;
		contentEl.empty();
		this._fileCache.clear();
		// Show loading indicator
		contentEl.createEl('p', { text: 'Loading...' });
		// Sync with Todoist
		let syncFailed = false;
		try {
			await this.plugin.todoistSyncAPI.incrementalSync();
		} catch (e) {
			console.error('[TaskManagerModal] Failed to refresh from Todoist:', e);
			syncFailed = true;
		}
		// Clear loading indicator
		contentEl.empty();
		// Show warning banner if sync failed
		if (syncFailed) {
			const banner = contentEl.createDiv({ cls: 'tm-warning' });
			banner.textContent = '⚠️ Could not refresh from Todoist. Showing cached data.';
		}
		// Classify tasks
		const mapping = this.plugin.settings.taskFileMapping;
		this.taskData = { conflicted: [], issue: [], nonActive: [] };
		for (const [taskId, info] of Object.entries(mapping)) {
			if (info.status === 'conflicted') this.taskData.conflicted.push(taskId);
			else if (info.status === 'issue') this.taskData.issue.push(taskId);
			else if (info.status === 'nonActive') this.taskData.nonActive.push(taskId);
		}
		// Header with summary badges
		const header = contentEl.createDiv({ cls: 'tm-header' });
		header.createEl('h3', { text: 'Task Manager' });
		const refreshBtn = header.createEl('button', { cls: 'tm-refresh-btn', text: '🔄' });
		refreshBtn.title = 'Refresh from Todoist';
		refreshBtn.addEventListener('click', () => {
			this.currentView = 'list';
			this.selectedTaskId = null;
			this.loadAndRender();
		});
		const summary = header.createDiv({ cls: 'tm-summary' });
		if (this.taskData.conflicted.length > 0) {
			summary.createSpan({ cls: 'tm-badge tm-badge--conflict', text: `⚠️ ${this.taskData.conflicted.length} conflicted` });
		}
		if (this.taskData.issue.length > 0) {
			summary.createSpan({ cls: 'tm-badge tm-badge--issue', text: `❗ ${this.taskData.issue.length} issue` });
		}
		if (this.taskData.nonActive.length > 0) {
			summary.createSpan({ cls: 'tm-badge tm-badge--nonactive', text: `${this.taskData.nonActive.length} inactive` });
		}
		// Create scroll area
		this.scrollArea = contentEl.createDiv({ cls: 'tm-scroll' });
		// Empty state
		if (this.taskData.conflicted.length === 0 && this.taskData.issue.length === 0 && this.taskData.nonActive.length === 0) {
			const empty = this.scrollArea.createDiv({ cls: 'tm-empty' });
			empty.createSpan({ cls: 'tm-empty-icon', text: '✅' });
			empty.createSpan({ cls: 'tm-empty-text', text: 'No problem tasks found. Everything is in sync.' });
			return;
		}
		await this.renderCurrentView();
	}
	private async renderCurrentView() {
		if (!this.scrollArea) return;
		// Remove any existing detail header
		const existingDetailHeader = this.contentEl.querySelector('.tm-detail-header');
		if (existingDetailHeader) existingDetailHeader.remove();
		this.scrollArea.empty();
		if (this.currentView === 'list') {
			await this.renderListView(this.scrollArea);
		} else {
			await this.renderDetailView(this.scrollArea);
		}
	}
	private async renderListView(scrollArea: HTMLElement) {
		// Bulk operations bar
		const bulkBar = scrollArea.createDiv({ cls: 'tm-bulk-bar' });
		let hasBulkOps = false;
		if (this.taskData.conflicted.length > 0) {
			hasBulkOps = true;
			const bulkObsBtn = bulkBar.createEl('button', { cls: 'tm-btn tm-btn--primary', text: 'Resolve All: Obsidian' });
			bulkObsBtn.addEventListener('click', async () => {
				bulkObsBtn.disabled = true;
				const ids = [...this.taskData.conflicted];
				for (let i = 0; i < ids.length; i++) {
					if (this._closed) return;
					const fp = this.plugin.settings.taskFileMapping[ids[i]]?.filePath || '';
					bulkObsBtn.textContent = `Resolving ${i + 1}/${ids.length}...`;
					await this.resolveConflict(ids[i], fp, 'obsidian', true);
				}
				if (!this._closed) await this.loadAndRender();
			});
			const bulkTodBtn = bulkBar.createEl('button', { cls: 'tm-btn tm-btn--secondary', text: 'Resolve All: Todoist' });
			bulkTodBtn.addEventListener('click', async () => {
				bulkTodBtn.disabled = true;
				const ids = [...this.taskData.conflicted];
				for (let i = 0; i < ids.length; i++) {
					if (this._closed) return;
					const fp = this.plugin.settings.taskFileMapping[ids[i]]?.filePath || '';
					bulkTodBtn.textContent = `Resolving ${i + 1}/${ids.length}...`;
					await this.resolveConflict(ids[i], fp, 'todoist', true);
				}
				if (!this._closed) await this.loadAndRender();
			});
		}
		if (this.taskData.issue.length > 0) {
			hasBulkOps = true;
			const bulkDelBtn = bulkBar.createEl('button', { cls: 'tm-btn tm-btn--danger', text: 'Delete All Issues' });
			bulkDelBtn.addEventListener('click', async () => {
				const confirmed = await this.showConfirmDialog(`Delete all ${this.taskData.issue.length} issue tasks?`);
				if (!confirmed) return;
				bulkDelBtn.disabled = true;
				const ids = [...this.taskData.issue];
				for (let i = 0; i < ids.length; i++) {
					if (this._closed) return;
					bulkDelBtn.textContent = `Deleting ${i + 1}/${ids.length}...`;
					await this.deleteIssueTask(ids[i], true);
				}
				if (!this._closed) await this.loadAndRender();
			});
		}
		if (this.taskData.nonActive.length > 0) {
			hasBulkOps = true;
			const bulkReBtn = bulkBar.createEl('button', { cls: 'tm-btn tm-btn--primary', text: 'Re-enable All' });
			bulkReBtn.addEventListener('click', async () => {
				bulkReBtn.disabled = true;
				const ids = [...this.taskData.nonActive];
				for (let i = 0; i < ids.length; i++) {
					if (this._closed) return;
					const fp = this.plugin.settings.taskFileMapping[ids[i]]?.filePath || '';
					bulkReBtn.textContent = `Re-enabling ${i + 1}/${ids.length}...`;
					await this.reEnableTask(ids[i], fp, true);
				}
				if (!this._closed) await this.loadAndRender();
			});
			const bulkDelInBtn = bulkBar.createEl('button', { cls: 'tm-btn tm-btn--danger', text: 'Delete All Inactive' });
			bulkDelInBtn.addEventListener('click', async () => {
				const confirmed = await this.showConfirmDialog(`Delete all ${this.taskData.nonActive.length} inactive tasks?`);
				if (!confirmed) return;
				bulkDelInBtn.disabled = true;
				const ids = [...this.taskData.nonActive];
				for (let i = 0; i < ids.length; i++) {
					if (this._closed) return;
					bulkDelInBtn.textContent = `Deleting ${i + 1}/${ids.length}...`;
					await this.deleteIssueTask(ids[i], true);
				}
				if (!this._closed) await this.loadAndRender();
			});
		}
		if (!hasBulkOps) bulkBar.remove();
		// Unified task list
		const iconMap: Record<string, string> = { conflicted: '⚠️', issue: '❗', nonActive: '📋' };
		const badgeMap: Record<string, { cls: string, text: string }> = {
			conflicted: { cls: 'tm-list-badge tm-list-badge--conflict', text: 'CONFLICT' },
			issue: { cls: 'tm-list-badge tm-list-badge--issue', text: 'ISSUE' },
			nonActive: { cls: 'tm-list-badge tm-list-badge--nonactive', text: 'INACTIVE' },
		};
		const allTasks: { taskId: string, type: string }[] = [];
		for (const id of this.taskData.conflicted) allTasks.push({ taskId: id, type: 'conflicted' });
		for (const id of this.taskData.issue) allTasks.push({ taskId: id, type: 'issue' });
		for (const id of this.taskData.nonActive) allTasks.push({ taskId: id, type: 'nonActive' });
		for (const { taskId, type } of allTasks) {
			const info = this.plugin.settings.taskFileMapping[taskId];
			const filePath = info?.filePath || '';
			const line = await this.getTaskLine(taskId, filePath);
			const preview = line
				? (this.plugin.taskParser.getTaskContentFromLineText(line) || '(unknown)')
				: '(unknown)';
			const row = scrollArea.createDiv({ cls: 'tm-list-row' });
			row.addEventListener('click', () => {
				this.selectedTaskId = taskId;
				this.currentView = 'detail';
				this.renderCurrentView();
			});
			row.createSpan({ cls: 'tm-list-icon', text: iconMap[type] });
			const cs = row.createSpan({ cls: 'tm-list-content', text: preview });
			cs.title = preview;
			row.createSpan({ cls: 'tm-list-file', text: filePath });
			row.createSpan({ cls: badgeMap[type].cls, text: badgeMap[type].text });
		}
	}
	private async renderDetailView(scrollArea: HTMLElement) {
		if (!this.selectedTaskId) {
			this.currentView = 'list';
			await this.renderCurrentView();
			return;
		}
		const taskId = this.selectedTaskId;
		const info = this.plugin.settings.taskFileMapping[taskId];
		if (!info) {
			new Notice('Task no longer exists in cache');
			this.currentView = 'list';
			this.selectedTaskId = null;
			await this.renderCurrentView();
			return;
		}
		const filePath = info.filePath || '';
		const status = info.status || 'active';
		// Detail header — insert before scrollArea
		const detailHeader = this.contentEl.createDiv({ cls: 'tm-detail-header' });
		this.contentEl.insertBefore(detailHeader, scrollArea);
		const backBtn = detailHeader.createEl('button', { cls: 'tm-detail-back', text: '←' });
		backBtn.addEventListener('click', () => {
			this.currentView = 'list';
			this.selectedTaskId = null;
			this.renderCurrentView();
		});
		detailHeader.createSpan({ cls: 'tm-detail-title', text: 'Task Detail' });
		// Detail body
		const body = scrollArea.createDiv({ cls: 'tm-detail-body' });
		// Info card
		const infoCard = body.createDiv({ cls: 'tm-detail-info' });
		const idRow = infoCard.createDiv({ cls: 'tm-detail-info-row' });
		idRow.createSpan({ cls: 'tm-detail-info-label', text: 'Task ID' });
		idRow.createSpan({ cls: 'tm-detail-info-value tm-task-id', text: taskId });
		const todoistRow = infoCard.createDiv({ cls: 'tm-detail-info-row' });
		todoistRow.createSpan({ cls: 'tm-detail-info-label', text: 'Todoist' });
		const todoistLink = todoistRow.createEl('a', { cls: 'tm-detail-info-value tm-todoist-link', text: 'Open in Todoist' });
		todoistLink.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.openTodoistTask(taskId);
		});
		const fileRow = infoCard.createDiv({ cls: 'tm-detail-info-row' });
		fileRow.createSpan({ cls: 'tm-detail-info-label', text: 'File' });
		const fileLink = fileRow.createEl('a', { cls: 'tm-detail-info-value tm-file-link', text: filePath || '—' });
		fileLink.addEventListener('click', () => this.openFile(filePath));
		const statusRow = infoCard.createDiv({ cls: 'tm-detail-info-row' });
		statusRow.createSpan({ cls: 'tm-detail-info-label', text: 'Status' });
		const badgeClsMap: Record<string, string> = {
			conflicted: 'tm-list-badge tm-list-badge--conflict',
			issue: 'tm-list-badge tm-list-badge--issue',
			nonActive: 'tm-list-badge tm-list-badge--nonactive',
		};
		const badgeTextMap: Record<string, string> = { conflicted: 'CONFLICT', issue: 'ISSUE', nonActive: 'INACTIVE' };
		statusRow.createSpan({ cls: badgeClsMap[status] || 'tm-list-badge', text: badgeTextMap[status] || status });
		// Type-specific detail
		if (status === 'conflicted') {
			await this.renderConflictDetail(body, taskId);
		} else if (status === 'issue') {
			await this.renderIssueDetail(body, taskId);
		} else if (status === 'nonActive') {
			await this.renderInactiveDetail(body, taskId);
		}
	}
	private async renderConflictDetail(container: HTMLElement, taskId: string) {
		const info = this.plugin.settings.taskFileMapping[taskId];
		const filePath = info?.filePath || '';
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
			const task = this.plugin.todoistSyncAPI.getTaskByIdLocal(taskId);
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
		const table = container.createEl('table', { cls: 'tm-diff' });
		const thead = table.createEl('thead');
		const headerRow = thead.createEl('tr');
		headerRow.createEl('th', { text: 'Field' });
		headerRow.createEl('th', { text: '' });
		headerRow.createEl('th', { text: 'Obsidian' });
		headerRow.createEl('th', { text: 'Todoist' });
		const tbody = table.createEl('tbody');
		const rows: [string, string, string][] = [
			['Content', obsContent, todContent],
			['Status', obsStatus, todStatus],
			['Due Date', obsDue, todDue],
			['Tags', obsTags, todTags],
			['Priority', obsPriority, todPriority],
		];
		for (const [field, obsVal, todVal] of rows) {
			const isDiff = obsVal !== todVal;
			const tr = tbody.createEl('tr');
			if (isDiff) tr.addClass('tm-diff-changed');
			tr.createEl('td', { cls: 'tm-diff-field', text: field });
			const marker = tr.createEl('td', { cls: 'tm-diff-marker' });
			if (isDiff) {
				marker.addClass('tm-diff-marker--changed');
				marker.textContent = '\u25cf';
			}
			const tdObs = tr.createEl('td');
			tdObs.addClass(obsVal ? 'tm-diff-val' : 'tm-diff-val tm-diff-val--empty');
			tdObs.textContent = obsVal || '\u2014';
			tdObs.title = obsVal;
			const tdTod = tr.createEl('td');
			tdTod.addClass(todVal ? 'tm-diff-val' : 'tm-diff-val tm-diff-val--empty');
			tdTod.textContent = todVal || '\u2014';
			tdTod.title = todVal;
		}
		// Action buttons
		const actions = container.createDiv({ cls: 'tm-detail-actions' });
		const keepObsBtn = actions.createEl('button', { cls: 'tm-btn tm-btn--primary', text: 'Keep Obsidian' });
		keepObsBtn.addEventListener('click', async () => {
			keepObsBtn.disabled = true;
			await this.resolveConflict(taskId, filePath, 'obsidian');
		});
		const keepTodBtn = actions.createEl('button', { cls: 'tm-btn tm-btn--secondary', text: 'Keep Todoist' });
		keepTodBtn.addEventListener('click', async () => {
			keepTodBtn.disabled = true;
			await this.resolveConflict(taskId, filePath, 'todoist');
		});
	}
	private async renderIssueDetail(container: HTMLElement, taskId: string) {
		const info = this.plugin.settings.taskFileMapping[taskId];
		const filePath = info?.filePath || '';
		const line = await this.getTaskLine(taskId, filePath);
		const preview = line
			? (this.plugin.taskParser.getTaskContentFromLineText(line) || line.substring(0, 60))
			: '(file not found)';
		const previewEl = container.createDiv({ cls: 'tm-content-preview' });
		previewEl.textContent = preview;
		const actions = container.createDiv({ cls: 'tm-detail-actions' });
		const delBtn = actions.createEl('button', { cls: 'tm-btn tm-btn--danger', text: 'Delete' });
		delBtn.addEventListener('click', async () => {
			delBtn.disabled = true;
			await this.deleteIssueTask(taskId);
		});
	}
	private async renderInactiveDetail(container: HTMLElement, taskId: string) {
		const info = this.plugin.settings.taskFileMapping[taskId];
		const filePath = info?.filePath || '';
		const line = await this.getTaskLine(taskId, filePath);
		const preview = line
			? (this.plugin.taskParser.getTaskContentFromLineText(line) || line.substring(0, 60))
			: '(file not found)';
		const previewEl = container.createDiv({ cls: 'tm-content-preview' });
		previewEl.textContent = preview;
		const actions = container.createDiv({ cls: 'tm-detail-actions' });
		const reEnableBtn = actions.createEl('button', { cls: 'tm-btn tm-btn--primary', text: 'Re-enable' });
		reEnableBtn.addEventListener('click', async () => {
			reEnableBtn.disabled = true;
			await this.reEnableTask(taskId, filePath);
		});
		const delBtn = actions.createEl('button', { cls: 'tm-btn tm-btn--danger', text: 'Delete' });
		delBtn.addEventListener('click', async () => {
			delBtn.disabled = true;
			await this.deleteIssueTask(taskId);
		});
	}
	private async resolveConflict(taskId: string, filePath: string, choice: 'obsidian' | 'todoist', skipRerender = false) {
		try {
			if (choice === 'obsidian') {
				const line = await this.getTaskLine(taskId, filePath);
				if (!line) { new Notice('Task line not found in vault'); this.navigateToList(); return; }
				const content = this.plugin.taskParser.getTaskContentFromLineText(line);
				const labels = this.plugin.taskParser.getAllTagsFromLineText(line);
				const dueDate = this.plugin.taskParser.getDueDateFromLineText(line);
				const priority = this.plugin.taskParser.getTaskPriority(line);
				const isCompleted = /\[(x|X)\]/.test(line);
				// Build batched commands for atomic resolve
				const commands: any[] = [];
				const updateArgs: Record<string, unknown> = { id: taskId };
				if (content) updateArgs.content = content;
				if (labels && labels.length > 0) updateArgs.labels = labels;
				if (dueDate) updateArgs.due = { date: dueDate };
				else updateArgs.due = { string: 'no date' };
				updateArgs.priority = priority;
				const updateUuid = crypto.randomUUID();
				commands.push({ type: 'item_update', uuid: updateUuid, args: updateArgs });
				const savedTask = this.plugin.todoistSyncAPI.getTaskByIdLocal(taskId);
				const todoistChecked = savedTask?.checked || false;
				let statusUuid: string | null = null;
				if (isCompleted && !todoistChecked) {
					statusUuid = crypto.randomUUID();
					commands.push({ type: 'item_close', uuid: statusUuid, args: { id: taskId } });
				} else if (!isCompleted && todoistChecked) {
					statusUuid = crypto.randomUUID();
					commands.push({ type: 'item_uncomplete', uuid: statusUuid, args: { id: taskId } });
				}
				// Single batched API call
				const result = await this.plugin.todoistSyncAPI.executeCommands(commands);
				// Check sync_status for each command
				if (result?.sync_status) {
					const updateStatus = result.sync_status[updateUuid];
					if (updateStatus && updateStatus !== 'ok') {
						const err = updateStatus as { error?: string };
						throw new Error(`Update failed: ${err.error || JSON.stringify(updateStatus)}`);
					}
					if (statusUuid) {
						const sStatus = result.sync_status[statusUuid];
						if (sStatus && sStatus !== 'ok') {
							const err = sStatus as { error?: string };
							throw new Error(`Status change failed: ${err.error || JSON.stringify(sStatus)}`);
						}
					}
				}
				if (this._closed) return;
				const refreshed = this.plugin.todoistSyncAPI.getTaskByIdLocal(taskId);
				await this.plugin.cacheOperation.setTaskFileMapping(taskId, filePath, 'active', true);
				if (refreshed?.updated_at) {
					await this.plugin.cacheOperation.updateTaskMappingSyncMeta(taskId, { updated_at: refreshed.updated_at });
				}
				await this.plugin.safeSettings?.update({}, true);
				new Notice(`Conflict resolved: kept Obsidian version`);
			} else {
				const task = this.plugin.todoistSyncAPI.getTaskByIdLocal(taskId);
				if (!task) { new Notice('Task not found in Todoist'); this.navigateToList(); return; }
				// Echo protection: prevent file writes from triggering push sync back to Todoist
				this.plugin.isSyncingFromTodoist = true;
				try {
					if (task.content) {
						await this.plugin.fileOperation.syncTaskContentToFile(taskId, task.content);
					}
					const todoistDueDate = task.due?.date || '';
					await this.plugin.fileOperation.syncTaskDueDateToFile(taskId, todoistDueDate);
					// Invalidate file cache after content/date writes so tag/priority sync reads fresh data
					this._fileCache.delete(filePath);
					// Sync tags (labels) from Todoist to file
					const todoistLabels = task.labels || [];
					let currentLine = await this.getTaskLine(taskId, filePath);
					if (currentLine && todoistLabels.length > 0) {
						const existingTags = this.plugin.taskParser.getAllTagsFromLineText(currentLine);
						// Remove existing tags (except #todoist and project tags)
						let updatedLine = currentLine;
						for (const tag of existingTags) {
							if (tag === 'todoist') continue;
							updatedLine = updatedLine.replace(new RegExp(`#${tag}\\b`, 'g'), '');
						}
						// Add Todoist labels as tags before #todoist
						const todoistTagPos = updatedLine.indexOf('#todoist');
						if (todoistTagPos > 0) {
							const labelTags = todoistLabels.map(l => `#${l}`).join(' ');
							updatedLine = updatedLine.substring(0, todoistTagPos) + labelTags + ' ' + updatedLine.substring(todoistTagPos);
						}
						// Clean up multiple spaces
						updatedLine = updatedLine.replace(/  +/g, ' ');
						if (updatedLine !== currentLine) {
							const file = this.app.vault.getAbstractFileByPath(filePath);
							if (file instanceof TFile) {
								const fileContent = await this.app.vault.read(file);
								const newContent = fileContent.replace(currentLine, updatedLine);
								await this.app.vault.modify(file, newContent);
								this._fileCache.delete(filePath);
							}
						}
					}
					// Sync priority from Todoist to file
					currentLine = await this.getTaskLine(taskId, filePath);
					if (currentLine) {
						const todoistPriority = task.priority || 1;
						const existingPriorityMatch = currentLine.match(/\s!!(\d)\s/);
						const existingPriority = existingPriorityMatch ? parseInt(existingPriorityMatch[1]) : 1;
						if (todoistPriority !== existingPriority) {
							let updatedLine: string;
							if (existingPriorityMatch) {
								updatedLine = currentLine.replace(/\s!!(\d)\s/, ` !!${todoistPriority} `);
							} else if (todoistPriority > 1) {
								// Insert priority before #todoist
								const todoistTagPos = currentLine.indexOf('#todoist');
								if (todoistTagPos > 0) {
									updatedLine = currentLine.substring(0, todoistTagPos) + `!!${todoistPriority} ` + currentLine.substring(todoistTagPos);
								} else {
									updatedLine = currentLine + ` !!${todoistPriority}`;
								}
							} else {
								updatedLine = currentLine;
							}
							if (updatedLine !== currentLine) {
								const file = this.app.vault.getAbstractFileByPath(filePath);
								if (file instanceof TFile) {
									const fileContent = await this.app.vault.read(file);
									const newContent = fileContent.replace(currentLine, updatedLine);
									await this.app.vault.modify(file, newContent);
									this._fileCache.delete(filePath);
								}
							}
						}
					}
					// Sync completion status
					currentLine = await this.getTaskLine(taskId, filePath);
					const obsidianChecked = currentLine ? /\[(x|X)\]/.test(currentLine) : false;
					const todoistChecked = task.checked || false;
					if (todoistChecked && !obsidianChecked) {
						await this.plugin.fileOperation.completeTaskInTheFile(taskId);
					} else if (!todoistChecked && obsidianChecked) {
						await this.plugin.fileOperation.uncompleteTaskInTheFile(taskId);
					}
				} finally {
					this.plugin.isSyncingFromTodoist = false;
				}
				if (this._closed) return;
				await this.plugin.cacheOperation.setTaskFileMapping(taskId, filePath, 'active', true);
				await this.plugin.cacheOperation.updateTaskMappingSyncMeta(taskId, { updated_at: task.updated_at });
				await this.plugin.safeSettings?.update({}, true);
				new Notice(`Conflict resolved: kept Todoist version`);
			}
		} catch (e) {
			console.error(`[TaskManagerModal] resolveConflict error:`, e);
			new Notice(`Error resolving conflict: ${e}`);
		}
		if (this._closed || skipRerender) return;
		this.currentView = 'list';
		this.selectedTaskId = null;
		await this.loadAndRender();
	}
    private async deleteIssueTask(taskId: string, skipRerender = false) {
        const confirmed = await this.showConfirmDialog(`Delete task ${taskId}? This removes it from Todoist and unbinds from file.`);
        if (!confirmed) return;
        try {
            try {
                await this.plugin.todoistSyncAPI.deleteTask(taskId);
            } catch (e: unknown) {
                // Only ignore 404 (task already deleted in Todoist)
                const err = e as Record<string, unknown>;
                const is404 = err.httpStatusCode === 404
                    || (typeof err.message === 'string' && (err.message.includes('404') || err.message.toLowerCase().includes('not found')));
                if (!is404) throw e;
            }
            if (this._closed) return;
            await this.plugin.fileOperation.unbindTaskInFile(taskId);
            await this.plugin.cacheOperation.deleteTaskFileMapping(taskId);
			await this.plugin.safeSettings?.update({}, true);
			new Notice(`Issue task deleted`);
        } catch (e) {
            console.error(`[TaskManagerModal] deleteIssueTask error:`, e);
            new Notice(`Error deleting task: ${e}`);
        }
        if (this._closed || skipRerender) return;
        this.currentView = 'list';
        this.selectedTaskId = null;
        await this.loadAndRender();
    }
    private async reEnableTask(taskId: string, filePath: string, skipRerender = false) {
        try {
            await this.plugin.cacheOperation.setTaskFileMapping(taskId, filePath, 'active', true);
			await this.plugin.safeSettings?.update({}, true);
			new Notice(`Task re-enabled`);
        } catch (e) {
            console.error(`[TaskManagerModal] reEnableTask error:`, e);
            new Notice(`Error re-enabling task: ${e}`);
        }
        if (this._closed || skipRerender) return;
        this.currentView = 'list';
        this.selectedTaskId = null;
        await this.loadAndRender();
    }
    private showConfirmDialog(message: string): Promise<boolean> {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'tm-confirm-overlay';
            this._activeOverlay = overlay;
            const cleanup = () => { overlay.remove(); this._activeOverlay = null; };
            const box = overlay.createDiv({ cls: 'tm-confirm-box' });
            box.createDiv({ cls: 'tm-confirm-msg', text: message });
            const actions = box.createDiv({ cls: 'tm-confirm-actions' });
            const cancelBtn = actions.createEl('button', { cls: 'tm-btn tm-btn--secondary', text: 'Cancel' });
            cancelBtn.addEventListener('click', () => { cleanup(); resolve(false); });
            const confirmBtn = actions.createEl('button', { cls: 'tm-btn tm-btn--danger', text: 'Delete' });
            confirmBtn.addEventListener('click', () => { cleanup(); resolve(true); });
            document.body.appendChild(overlay);
        });
    }
	private openFile(filePath: string) {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			this.app.workspace.getLeaf(false).openFile(file);
		}
	}
	private buildTodoistTaskUrl(taskId: string): string {
		const encodedTaskId = encodeURIComponent(taskId);
		if (this.plugin.settings.useAppURI) {
			return `todoist://task?id=${encodedTaskId}`;
		}

		return `https://app.todoist.com/app/task/${encodedTaskId}`;
	}
	private openTodoistTask(taskId: string): void {
		if (!taskId) {
			new Notice('Task ID not found.');
			return;
		}

		const url = this.buildTodoistTaskUrl(taskId);
		window.open(url, '_blank', 'noopener,noreferrer');
	}
	private navigateToList() {
		this.currentView = 'list';
		this.selectedTaskId = null;
		this.renderCurrentView();
    }
    private async getTaskLine(taskId: string, filePath: string): Promise<string | null> {
        try {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (!(file instanceof TFile)) return null;
            // Check file cache first
            let content = this._fileCache.get(filePath);
            if (!content) {
                content = await this.app.vault.read(file);
                this._fileCache.set(filePath, content);
            }
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
        this._closed = true;
        // Clean up any lingering confirm dialog overlay
        if (this._activeOverlay) {
            this._activeOverlay.remove();
            this._activeOverlay = null;
        }
        const { contentEl } = this;
        contentEl.empty();
    }
}
