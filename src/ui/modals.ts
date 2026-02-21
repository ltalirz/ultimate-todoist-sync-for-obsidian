import { App, Modal, Setting } from "obsidian";
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
