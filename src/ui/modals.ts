import { App, Modal, Setting, TextComponent } from "obsidian";
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
    console.log(this.defaultProjectId)
    console.log(this.defaultProjectName)
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
                    console.log(`project id  is ${value}`)
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
