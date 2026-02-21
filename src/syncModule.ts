import UltimateTodoistSyncForObsidian from "../main";
import { App, Editor, MarkdownView } from 'obsidian';
import { ObsidianToTodoistSync } from './obsidianToTodoist';
import { TodoistToObsidianSync } from './todoistToObsidian';

export class TodoistSync {
    app: App;
    plugin: UltimateTodoistSyncForObsidian;
    obsidianToTodoist: ObsidianToTodoistSync;
    todoistToObsidian: TodoistToObsidianSync;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
        this.obsidianToTodoist = new ObsidianToTodoistSync(app, plugin);
        this.todoistToObsidian = new TodoistToObsidianSync(app, plugin);
    }

    async deletedTaskCheck(file_path: string): Promise<number> {
        return this.obsidianToTodoist.deletedTaskCheck(file_path);
    }

    async lineContentNewTaskCheck(editor: Editor, view: MarkdownView): Promise<void> {
        return this.obsidianToTodoist.lineContentNewTaskCheck(editor, view);
    }

    async fullTextNewTaskCheck(file_path: string): Promise<void> {
        return this.obsidianToTodoist.fullTextNewTaskCheck(file_path);
    }

    async lineModifiedTaskCheck(filepath: string, lineText: string, lineNumber: number, fileContent: string): Promise<void> {
        return this.obsidianToTodoist.lineModifiedTaskCheck(filepath, lineText, lineNumber, fileContent);
    }

    async fullTextModifiedTaskCheck(file_path: string): Promise<void> {
        return this.obsidianToTodoist.fullTextModifiedTaskCheck(file_path);
    }

    async closeTask(taskId: string): Promise<void> {
        return this.obsidianToTodoist.closeTask(taskId);
    }

    async repoenTask(taskId: string): Promise<void> {
        return this.obsidianToTodoist.repoenTask(taskId);
    }

    async deleteTasksByIds(taskIds: string[]): Promise<string[]> {
        return this.obsidianToTodoist.deleteTasksByIds(taskIds);
    }

    async updateTaskDescription(filepath: string): Promise<void> {
        return this.obsidianToTodoist.updateTaskDescription(filepath);
    }

    async syncTodoistToObsidian(): Promise<void> {
        return this.todoistToObsidian.syncTodoistToObsidian();
    }

    async backupTodoistAllResources(): Promise<void> {
        return this.todoistToObsidian.backupTodoistAllResources();
    }
}
