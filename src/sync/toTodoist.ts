import UltimateTodoistSyncForObsidian from "../../main";
import { App, Editor, MarkdownView, Notice } from 'obsidian';

export class ObsidianToTodoistSync {
    app: App;
    plugin: UltimateTodoistSyncForObsidian;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    async deletedTaskCheck(file_path: string): Promise<number> {
        let file;
        let currentFileValue;
        let view;
        let filepath;
        if (file_path) {
            file = this.app.vault.getAbstractFileByPath(file_path);
            filepath = file_path;
            currentFileValue = await this.app.vault.read(file);
        } else {
            view = this.app.workspace.getActiveViewOfType(MarkdownView);
            file = this.app.workspace.getActiveFile();
            filepath = file?.path;
            currentFileValue = view?.data;
        }
        const taskIds = this.plugin.cacheOperation.getTasksInFile(filepath);
        if (taskIds.length === 0) {
            this.plugin.debugLog('No tasks in this file');
            return 0;
        }

        const currentFileValueWithOutFrontMatter = currentFileValue.replace(/^---[\s\S]*?---\n/, '');

        const tasksToDelete = taskIds.filter(
            (taskId: string) =>
                !currentFileValueWithOutFrontMatter.includes(taskId) &&
                this.plugin.cacheOperation.isTaskSyncEnabled(taskId)
        );

        let deletedCount = 0;
        for (const taskId of tasksToDelete) {
            try {
                const api = this.plugin.todoistSyncAPI.initializeAPI();
                const response = await api.deleteTask(taskId);
                if (response) {
                    new Notice(`task ${taskId} is deleted`);
                    this.plugin.logOperation?.log('OBSIDIAN_TASK_DELETED', `Deleted task: ${taskId}`, undefined, taskId);
                    await this.plugin.cacheOperation.deleteTaskFileMapping(taskId);
                    deletedCount++;
                }
            } catch (error) {
                console.error(`Failed to delete task ${taskId}: ${error}`);
                new Notice(`Failed to delete task ${taskId}. Check console for details.`);
            }
        }

        if (deletedCount > 0) {
            this.plugin.saveSettings();
        }

        return deletedCount;
    }

    async lineContentNewTaskCheck(editor: Editor, view: MarkdownView): Promise<void> {
        const filepath = view.file?.path;
        const fileContent = view?.data;
        const cursor = editor.getCursor();
        const line = cursor.line;
        const linetxt = editor.getLine(line);

        const hasId = this.plugin.taskParser.hasTodoistId(linetxt);
        const hasTag = this.plugin.taskParser.hasTodoistTag(linetxt);
        const fullVault = this.plugin.settings.enableFullVaultSync;
        const isTask = this.plugin.taskParser.isMarkdownTask(linetxt);
        const contentNotEmpty = isTask && this.plugin.taskParser.getTaskContentFromLineText(linetxt) !== "";

        const isNewTask = !hasId && (hasTag || (fullVault && contentNotEmpty));

        if (isNewTask) {
            const processedLine = hasTag ? linetxt : this.plugin.taskParser.addTodoistTag(linetxt);
            this.plugin.debugLog('this is a new task');
            this.plugin.debugLog(processedLine);
            const currentTask = await this.plugin.taskParser.convertTextToTodoistTaskObject(processedLine, filepath, line, fileContent);

            try {
                const newTask = await this.plugin.todoistSyncAPI.AddTask(currentTask);
                const { id: todoist_id } = newTask;
                newTask.path = filepath;
                new Notice(`new task ${newTask.content} id is ${newTask.id}`);

                this.plugin.logOperation?.log('OBSIDIAN_TASK_CREATED', `Created task in Obsidian: ${newTask.content}`, filepath, todoist_id, 'obsidian→todoist');
                this.plugin.logOperation?.log('TODOIST_TASK_CREATED', `Created task in Todoist: ${newTask.content}`, filepath, todoist_id, 'obsidian→todoist');

                this.plugin.cacheOperation.setTaskFileMapping(todoist_id, filepath || '');

                // Immediately sync so syncData contains the new task before any
                // subsequent lineModifiedTaskCheck fires on the same line.
                try {
                    await this.plugin.todoistSyncAPI.incrementalSync();
                } catch (syncErr) {
                    console.error('[lineContentNewTaskCheck] Post-create incremental sync failed:', syncErr);
                }

                if (currentTask.isCompleted === true) {
                    await this.plugin.todoistSyncAPI.CloseTask(newTask.id);
                    // taskFileMapping already set above
                    this.plugin.logOperation?.log('OBSIDIAN_TASK_COMPLETED', `Completed task in Obsidian: ${newTask.content}`, filepath, todoist_id, 'obsidian→todoist');
                    this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Completed task in Todoist: ${newTask.content}`, filepath, todoist_id, 'obsidian→todoist');
                }

                const text_with_out_link = `${processedLine} %%[todoist_id:: ${todoist_id}]%%`;
                const link = this.plugin.settings.useAppURI ? `[link](todoist://task?id=${newTask.id})` : `[link](https://app.todoist.com/app/task/${newTask.id})`;
                const text = this.plugin.taskParser.addTodoistLink(text_with_out_link, link);
                const from = { line: cursor.line, ch: 0 };
                const to = { line: cursor.line, ch: linetxt.length };
                try {
                    view.app.workspace.activeEditor?.editor?.replaceRange(text, from, to);
                } catch (replaceError) {
                    // replaceRange failed — roll back Todoist task to avoid duplicate on next trigger
                    console.error('[lineContentNewTaskCheck] replaceRange failed, rolling back Todoist task:', replaceError);
                    try {
                        const api = this.plugin.todoistSyncAPI.initializeAPI();
                        await api.deleteTask(todoist_id);
                    } catch (deleteError) {
                        console.error('[lineContentNewTaskCheck] Rollback failed:', deleteError);
                    }
                    await this.plugin.cacheOperation.deleteTaskFileMapping(todoist_id);
                    new Notice(`Failed to write task ID to file. Todoist task rolled back. Please try again.`);
                    return;
                }

                try {
                    this.plugin.saveSettings();
                } catch (error) {
                    console.error(error);
                }

            } catch (error) {
                console.error('Error adding task:', error);
                this.plugin.debugLog(`The error occurred in the file: ${filepath}`);
                new Notice(`Failed to create task. Check console for details.`);
                return;
            }
        }
    }

    async fullTextNewTaskCheck(file_path: string): Promise<void> {
        let file;
        let currentFileValue;
        let view;
        let filepath;
        if (file_path) {
            file = this.app.vault.getAbstractFileByPath(file_path);
            filepath = file_path;
            currentFileValue = await this.app.vault.read(file);
        } else {
            view = this.app.workspace.getActiveViewOfType(MarkdownView);
            file = this.app.workspace.getActiveFile();
            filepath = file?.path;
            currentFileValue = view?.data;
        }
        if (this.plugin.settings.enableFullVaultSync) {
            await this.plugin.fileOperation.addTodoistTagToFile(filepath);
            currentFileValue = await this.app.vault.read(file);
        }

        // Prevent per-task vault.modify from triggering modify event storm
        this.plugin.isProcessingModify = true;
        try {
            let lines = currentFileValue.split('\n');
        for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!this.plugin.taskParser.hasTodoistId(line) && this.plugin.taskParser.hasTodoistTag(line)) {
                    this.plugin.debugLog(filepath);
                    const currentTask = await this.plugin.taskParser.convertTextToTodoistTaskObject(line, filepath, i, lines.join('\n'));
                    if (typeof currentTask === 'undefined') {
                        continue;
                    }
                this.plugin.debugLog(currentTask);
                    let todoist_id: string | undefined;
                    try {
                        const newTask = await this.plugin.todoistSyncAPI.AddTask(currentTask);
                        todoist_id = newTask.id;
                        newTask.path = filepath;
                        this.plugin.debugLog(newTask);
                        new Notice(`new task ${newTask.content} id is ${newTask.id}`);
                        this.plugin.logOperation?.log('OBSIDIAN_TASK_CREATED', `Created task in Obsidian: ${newTask.content}`, filepath, todoist_id, 'obsidian\u2192todoist');
                        this.plugin.logOperation?.log('TODOIST_TASK_CREATED', `Created task in Todoist: ${newTask.content}`, filepath, todoist_id, 'obsidian\u2192todoist');

                        this.plugin.cacheOperation.setTaskFileMapping(todoist_id, filepath || '');
                    if (currentTask.isCompleted === true) {
                            await this.plugin.todoistSyncAPI.CloseTask(newTask.id);
                            this.plugin.logOperation?.log('OBSIDIAN_TASK_COMPLETED', `Completed task in Obsidian: ${newTask.content}`, filepath, todoist_id, 'obsidian\u2192todoist');
                            this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Completed task in Todoist: ${newTask.content}`, filepath, todoist_id, 'obsidian\u2192todoist');
                        }
                    const text_with_out_link = `${line} %%[todoist_id:: ${todoist_id}]%%`;
                        const link = this.plugin.settings.useAppURI ? `[link](todoist://task?id=${newTask.id})` : `[link](https://app.todoist.com/app/task/${newTask.id})`;
                        const text = this.plugin.taskParser.addTodoistLink(text_with_out_link, link);
                    lines[i] = text;
                        // Atomic: write file immediately after each task
                        const newContent = lines.join('\n');
                        await this.plugin.backupOperation?.backupFile(filepath);
                        await this.app.vault.modify(file, newContent);
            this.plugin.saveSettings();
                        // Re-read file so subsequent iterations use the latest content
                        const refreshed = await this.app.vault.read(file);
                        lines = refreshed.split('\n');

                    } catch (error) {
                        console.error('Error adding task:', error);
                        new Notice(`Failed to create task. Check console for details.`);
                        // Rollback: delete Todoist task + clean mapping if we got an id
                        if (todoist_id) {
                            try {
                                await this.plugin.todoistSyncAPI.deleteTask(todoist_id);
                            } catch (deleteError) {
                                console.error('[fullTextNewTaskCheck] Rollback deleteTask failed:', deleteError);
                            }
                            await this.plugin.cacheOperation.deleteTaskFileMapping(todoist_id);
                        }
                        continue;
                    }
                }
            }
        } finally {
            this.plugin.isProcessingModify = false;
        }
    }

    async lineModifiedTaskCheck(filepath: string, lineText: string, lineNumber: number, fileContent: string): Promise<void> {
        if (this.plugin.taskParser.hasTodoistId(lineText) && this.plugin.taskParser.hasTodoistTag(lineText)) {
            const lineTask = await this.plugin.taskParser.convertTextToTodoistTaskObject(lineText, filepath, lineNumber, fileContent);
            const lineTask_todoist_id = (lineTask.todoist_id).toString();

            const taskMapping = this.plugin.cacheOperation.getTaskFileMapping(lineTask_todoist_id);
            if (!taskMapping) {
                this.plugin.debugLog(`Local cache has no task ${lineTask.todoist_id}`);
                const url = this.plugin.taskParser.getObsidianUrlFromFilepath(filepath);
                this.plugin.debugLog(url);
                return;
            }

            if (!this.plugin.cacheOperation.isTaskSyncEnabled(lineTask_todoist_id)) {
                return;
            }

            const savedTask = await this.plugin.todoistSyncAPI.GetTaskById(lineTask_todoist_id);

            // Handle deleted task: task exists in cache but not in Todoist
            if (!savedTask) {
                // If the task was just created (mapping exists but syncData not yet updated),
                // skip silently rather than marking as issue. The incremental sync running
                // in the background will populate syncData shortly.
                const mappingAge = taskMapping.updated_at
                    ? Date.now() - new Date(taskMapping.updated_at).getTime()
                    : 0;
                if (mappingAge < 30000) {
                    this.plugin.debugLog(`[lineModifiedTaskCheck] Task ${lineTask_todoist_id} not in syncData yet (just created), skipping`);
                    return;
                }
                console.warn(`[lineModifiedTaskCheck] Task ${lineTask_todoist_id} not found in Todoist (deleted?), marking as issue`);
                await this.plugin.cacheOperation.setTaskFileMapping(lineTask_todoist_id, taskMapping.filePath, 'issue', false);
                new Notice(`Task ${lineTask_todoist_id} no longer exists in Todoist. Sync disabled.`);
                this.plugin.logOperation?.log('CONFLICT_DETECTED', `Task ${lineTask_todoist_id} missing in Todoist`, filepath, lineTask_todoist_id);
                return;
            }

            // Conflict detection: if Todoist was updated since our last sync
            if (taskMapping.updated_at && savedTask.updated_at && savedTask.updated_at !== taskMapping.updated_at) {
                const strategy = this.plugin.settings.conflictResolutionStrategy;
                console.warn(`[lineModifiedTaskCheck] Conflict on task ${lineTask_todoist_id}: strategy=${strategy}`);
                this.plugin.logOperation?.log('CONFLICT_DETECTED', `Conflict on task ${lineTask_todoist_id} (strategy: ${strategy})`, filepath, lineTask_todoist_id);

                if (strategy === 'todoist-wins') {
                    // Let toObsidian pull overwrite Obsidian on next sync — just update cached updated_at
                    await this.plugin.cacheOperation.updateTaskMappingSyncMeta(lineTask_todoist_id, { updated_at: undefined });
                    new Notice(`Conflict on task ${lineTask_todoist_id}: Todoist wins — Obsidian will be updated on next sync.`);
                    return;
                } else if (strategy === 'obsidian-wins') {
                    // Force-update Todoist with Obsidian content — fall through to normal update logic below
                    new Notice(`Conflict on task ${lineTask_todoist_id}: Obsidian wins — pushing to Todoist.`);
                    // Reset cached updated_at so toObsidian won't overwrite back
                    await this.plugin.cacheOperation.updateTaskMappingSyncMeta(lineTask_todoist_id, { updated_at: savedTask.updated_at });
                    // fall through
                } else {
                    // manual: disable sync until user resolves
                    await this.plugin.cacheOperation.setTaskFileMapping(lineTask_todoist_id, taskMapping.filePath, 'conflicted', false);
                    new Notice(`Task ${lineTask_todoist_id} has a conflict: modified in both Obsidian and Todoist. Sync disabled until resolved.`);
                    return;
                }
            }

            const lineTaskContent = lineTask.content;
            const contentModified = !this.plugin.taskParser.taskContentCompare(lineTask, savedTask);
            const tagsModified = !this.plugin.taskParser.taskTagCompare(lineTask, savedTask);
            const statusModified = !this.plugin.taskParser.taskStatusCompare(lineTask, savedTask);
            const dueDateModified = !this.plugin.taskParser.compareTaskDueDate(lineTask, savedTask);
            const priorityModified = !(lineTask.priority === savedTask.priority);

            try {
                let contentChanged = false;
                let tagsChanged = false;
                let statusChanged = false;
                let dueDateChanged = false;
                let priorityChanged = false;

                const updatedContent: Record<string, unknown> = {};
                if (contentModified) {
                    this.plugin.debugLog(`Content modified for task ${lineTask_todoist_id}`);
                    updatedContent.content = lineTaskContent;
                    contentChanged = true;
                }

                if (tagsModified) {
                    this.plugin.debugLog(`Tags modified for task ${lineTask_todoist_id}`);
                    updatedContent.labels = lineTask.labels;
                    tagsChanged = true;
                }

                if (dueDateModified) {
                    this.plugin.debugLog(`Due date modified for task ${lineTask_todoist_id}`);
                    this.plugin.debugLog(lineTask.dueDate);
                    if (lineTask.dueDate === "") {
                        updatedContent.dueString = "no date";
                    } else {
                        updatedContent.dueDate = lineTask.dueDate;
                    }
                    dueDateChanged = true;
                }

                if (priorityModified) {
                    updatedContent.priority = lineTask.priority;
                    priorityChanged = true;
                }

                if (contentChanged || tagsChanged || dueDateChanged || priorityChanged) {
                    const updatedTask = await this.plugin.todoistSyncAPI.UpdateTask(lineTask.todoist_id.toString(), updatedContent);
                    // taskFileMapping already set, no need to update
                    this.plugin.logOperation?.log('OBSIDIAN_TASK_MODIFIED', `Updated task: ${updatedTask.content}`, filepath, lineTask_todoist_id, 'obsidian→todoist');
                    this.plugin.logOperation?.log('TODOIST_TASK_UPDATED', `Updated task in Todoist: ${updatedTask.content}`, filepath, lineTask_todoist_id, 'obsidian→todoist');
                }

                if (statusModified) {
                    this.plugin.debugLog(`Status modified for task ${lineTask_todoist_id}`);
                    if (lineTask.isCompleted === true) {
                        this.plugin.debugLog(`task completed`);
                        await this.plugin.todoistSyncAPI.CloseTask(lineTask.todoist_id.toString());
                        // taskFileMapping already set, no need to update
                        this.plugin.logOperation?.log('OBSIDIAN_TASK_COMPLETED', `Completed task: ${lineTask.content}`, filepath, lineTask_todoist_id, 'obsidian→todoist');
                        this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Completed task in Todoist: ${lineTask.content}`, filepath, lineTask_todoist_id, 'obsidian→todoist');
                    } else {
                        this.plugin.debugLog(`task uncompleted`);
                        await this.plugin.todoistSyncAPI.OpenTask(lineTask.todoist_id.toString());
                        // taskFileMapping already set, no need to update
                        this.plugin.logOperation?.log('OBSIDIAN_TASK_REOPENED', `Reopened task: ${lineTask.content}`, filepath, lineTask_todoist_id);
                        this.plugin.logOperation?.log('TODOIST_TASK_REOPENED', `Reopened task in Todoist: ${lineTask.content}`, filepath, lineTask_todoist_id, 'obsidian→todoist');
                    }
                    statusChanged = true;
                }

                if (contentChanged || statusChanged || dueDateChanged || tagsChanged || priorityChanged) {
                    this.plugin.debugLog(lineTask);
                    this.plugin.debugLog(savedTask);
                    this.plugin.saveSettings();
                    let message = `Task ${lineTask_todoist_id} is updated.`;

                    if (contentChanged) {
                        message += " Content was changed.";
                    }
                    if (statusChanged) {
                        message += " Status was changed.";
                    }
                    if (dueDateChanged) {
                        message += " Due date was changed.";
                    }
                    if (tagsChanged) {
                        message += " Tags were changed.";
                    }
                    if (priorityChanged) {
                        message += " Priority was changed.";
                    }

                    new Notice(message);
                }

            } catch (error) {
                console.error('Error updating task:', error);
                new Notice(`Failed to update task ${lineTask_todoist_id}. Check console for details.`);
            }
        }
    }

    async fullTextModifiedTaskCheck(file_path: string): Promise<void> {
        let file;
        let currentFileValue;
        let view;
        let filepath;

        try {
            if (file_path) {
                file = this.app.vault.getAbstractFileByPath(file_path);
                filepath = file_path;
                currentFileValue = await this.app.vault.read(file);
            } else {
                view = this.app.workspace.getActiveViewOfType(MarkdownView);
                file = this.app.workspace.getActiveFile();
                filepath = file?.path;
                currentFileValue = view?.data;
            }

            const content = currentFileValue;
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (this.plugin.taskParser.hasTodoistId(line) && this.plugin.taskParser.hasTodoistTag(line)) {
                    try {
                        await this.lineModifiedTaskCheck(filepath, line, i, content);
                    } catch (error) {
                        console.error('Error modifying task:', error);
                        continue;
                    }
                }
            }
        } catch (error) {
            console.error('Error:', error);
        }
    }

    async closeTask(taskId: string): Promise<void> {
        if (!this.plugin.cacheOperation?.isTaskSyncEnabled(taskId)) return;
        try {
            const taskMapping = this.plugin.cacheOperation.getTaskFileMapping(taskId);
            const savedTask = await this.plugin.todoistSyncAPI.GetTaskById(taskId);

            if (!savedTask) {
                await this.plugin.cacheOperation.setTaskFileMapping(taskId, taskMapping?.filePath || '', 'issue', false);
                new Notice(`Task ${taskId} no longer exists in Todoist. Sync disabled.`);
                return;
            }

            if (taskMapping?.updated_at && savedTask.updated_at && savedTask.updated_at !== taskMapping.updated_at) {
                const strategy = this.plugin.settings.conflictResolutionStrategy;
                this.plugin.logOperation?.log('CONFLICT_DETECTED', `Conflict on closeTask ${taskId} (strategy: ${strategy})`, undefined, taskId);
                if (strategy === 'todoist-wins') {
                    await this.plugin.cacheOperation.updateTaskMappingSyncMeta(taskId, { updated_at: undefined });
                    new Notice(`Conflict on task ${taskId}: Todoist wins — Obsidian will be updated on next sync.`);
                    return;
                } else if (strategy === 'manual') {
                    await this.plugin.cacheOperation.setTaskFileMapping(taskId, taskMapping.filePath, 'conflicted', false);
                    new Notice(`Task ${taskId} has a conflict. Sync disabled until resolved.`);
                    return;
                }
                // obsidian-wins: fall through and close
            }

            await this.plugin.todoistSyncAPI.CloseTask(taskId);
            await this.plugin.fileOperation.completeTaskInTheFile(taskId);
            this.plugin.saveSettings();
            new Notice(`Task ${taskId} is closed.`);
            this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Closed task via checkbox: ${taskId}`, undefined, taskId, 'obsidian→todoist');
        } catch (error) {
            console.error('Error closing task:', error);
            throw error;
        }
    }

    async repoenTask(taskId: string): Promise<void> {
        if (!this.plugin.cacheOperation?.isTaskSyncEnabled(taskId)) return;
        try {
            const taskMapping = this.plugin.cacheOperation.getTaskFileMapping(taskId);
            const savedTask = await this.plugin.todoistSyncAPI.GetTaskById(taskId);

            if (!savedTask) {
                await this.plugin.cacheOperation.setTaskFileMapping(taskId, taskMapping?.filePath || '', 'issue', false);
                new Notice(`Task ${taskId} no longer exists in Todoist. Sync disabled.`);
                return;
            }

            if (taskMapping?.updated_at && savedTask.updated_at && savedTask.updated_at !== taskMapping.updated_at) {
                const strategy = this.plugin.settings.conflictResolutionStrategy;
                this.plugin.logOperation?.log('CONFLICT_DETECTED', `Conflict on repoenTask ${taskId} (strategy: ${strategy})`, undefined, taskId);
                if (strategy === 'todoist-wins') {
                    await this.plugin.cacheOperation.updateTaskMappingSyncMeta(taskId, { updated_at: undefined });
                    new Notice(`Conflict on task ${taskId}: Todoist wins — Obsidian will be updated on next sync.`);
                    return;
                } else if (strategy === 'manual') {
                    await this.plugin.cacheOperation.setTaskFileMapping(taskId, taskMapping.filePath, 'conflicted', false);
                    new Notice(`Task ${taskId} has a conflict. Sync disabled until resolved.`);
                    return;
                }
                // obsidian-wins: fall through and reopen
            }

            await this.plugin.todoistSyncAPI.OpenTask(taskId);
            await this.plugin.fileOperation.uncompleteTaskInTheFile(taskId);
            this.plugin.saveSettings();
            new Notice(`Task ${taskId} is reopened.`);
            this.plugin.logOperation?.log('TODOIST_TASK_REOPENED', `Reopened task via checkbox: ${taskId}`, undefined, taskId, 'obsidian→todoist');
        } catch (error) {
            console.error('Error opening task:', error);
            throw error;
        }
    }



    async updateTaskDescription(filepath: string): Promise<void> {
        const taskIds = this.plugin.cacheOperation.getTasksInFile(filepath);

        if (taskIds.length === 0) {
            return;
        }

        for (const taskId of taskIds) {
            try {
                const taskMapping = this.plugin.cacheOperation.getTaskFileMapping(taskId);
                if (taskMapping) {
                    if (!this.plugin.cacheOperation.isTaskSyncEnabled(taskId)) continue;
                    const description = `[[${filepath}]]`;
                    await this.plugin.todoistSyncAPI.UpdateTask(taskId, { description });
                    this.plugin.logOperation?.log('TODOIST_TASK_UPDATED', `Updated task description: ${taskId}`, filepath, taskId, 'obsidian→todoist');
                }
            } catch (error) {
                console.error(`Error updating task description for ${taskId}:`, error);
            }
        }
    }
}
