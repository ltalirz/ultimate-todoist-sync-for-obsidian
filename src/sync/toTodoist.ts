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
            console.log('No tasks in this file');
            return 0;
        }

        const currentFileValueWithOutFrontMatter = currentFileValue.replace(/^---[\s\S]*?---\n/, '');

        const deleteTasksPromises = taskIds
            .filter((taskId: string) => !currentFileValueWithOutFrontMatter.includes(taskId))
            .map(async (taskId: string) => {
                try {
                    const api = this.plugin.todoistSyncAPI.initializeAPI();
                    const response = await api.deleteTask(taskId);

                    if (response) {
                        new Notice(`task ${taskId} is deleted`);
                        this.plugin.logOperation?.log('OBSIDIAN_TASK_DELETED', `Deleted task: ${taskId}`, undefined, taskId);
                        return taskId;
                    }
                } catch (error) {
                    console.error(`Failed to delete task ${taskId}: ${error}`);
                }
            });

        const deletedTaskIds = await Promise.all(deleteTasksPromises);
        const validDeletedIds = deletedTaskIds.filter((id): id is string => id !== undefined);
        
        if (validDeletedIds.length === 0) {
            return 0;
        }
        
        for (const taskId of validDeletedIds) {
            this.plugin.cacheOperation.deleteTaskFileMapping(taskId);
        }
        
        return validDeletedIds.length;
    }

    async lineContentNewTaskCheck(editor: Editor, view: MarkdownView): Promise<void> {
        const filepath = view.file?.path;
        const fileContent = view?.data;
        const cursor = editor.getCursor();
        const line = cursor.line;
        const linetxt = editor.getLine(line);

        if ((!this.plugin.taskParser.hasTodoistId(linetxt) && this.plugin.taskParser.hasTodoistTag(linetxt))) {
            console.log('this is a new task');
            console.log(linetxt);
            const currentTask = await this.plugin.taskParser.convertTextToTodoistTaskObject(linetxt, filepath, line, fileContent);

            try {
                const newTask = await this.plugin.todoistSyncAPI.AddTask(currentTask);
                const { id: todoist_id } = newTask;
                newTask.path = filepath;
                new Notice(`new task ${newTask.content} id is ${newTask.id}`);

                this.plugin.logOperation?.log('OBSIDIAN_TASK_CREATED', `Created task in Obsidian: ${newTask.content}`, filepath, todoist_id);
                this.plugin.logOperation?.log('TODOIST_TASK_CREATED', `Created task in Todoist: ${newTask.content}`, filepath, todoist_id);

                this.plugin.cacheOperation.setTaskFileMapping(todoist_id, filepath || '', line);

                if (currentTask.isCompleted === true) {
                    await this.plugin.todoistSyncAPI.CloseTask(newTask.id);
                    // taskFileMapping already set above
                    this.plugin.logOperation?.log('OBSIDIAN_TASK_COMPLETED', `Completed task in Obsidian: ${newTask.content}`, filepath, todoist_id);
                    this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Completed task in Todoist: ${newTask.content}`, filepath, todoist_id);
                }

                const text_with_out_link = `${linetxt} %%[todoist_id:: ${todoist_id}]%%`;
                const link = this.plugin.settings.useAppURI ? `[link](todoist://task?id=${newTask.id})` : `[link](https://app.todoist.com/app/task/${newTask.id})`;
                const text = this.plugin.taskParser.addTodoistLink(text_with_out_link, link);
                const from = { line: cursor.line, ch: 0 };
                const to = { line: cursor.line, ch: linetxt.length };
                view.app.workspace.activeEditor?.editor?.replaceRange(text, from, to);

                try {
                    this.plugin.saveSettings();
                } catch (error) {
                    console.error(error);
                }

            } catch (error) {
                console.error('Error adding task:', error);
                console.log(`The error occurred in the file: ${filepath}`);
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
        }

        const content = currentFileValue;

        let hasNewTask = false;
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!this.plugin.taskParser.hasTodoistId(line) && this.plugin.taskParser.hasTodoistTag(line)) {
                console.log(filepath);
                const currentTask = await this.plugin.taskParser.convertTextToTodoistTaskObject(line, filepath, i, content);
                if (typeof currentTask === "undefined") {
                    continue;
                }
                console.log(currentTask);
                try {
                    const newTask = await this.plugin.todoistSyncAPI.AddTask(currentTask);
                    const { id: todoist_id } = newTask;
                    newTask.path = filepath;
                    console.log(newTask);
                    new Notice(`new task ${newTask.content} id is ${newTask.id}`);

                this.plugin.cacheOperation.setTaskFileMapping(todoist_id, filepath || '', i);

                    if (currentTask.isCompleted === true) {
                        await this.plugin.todoistSyncAPI.CloseTask(newTask.id);
                        // taskFileMapping already set above
                    }
                    this.plugin.saveSettings();

                    const text_with_out_link = `${line} %%[todoist_id:: ${todoist_id}]%%`;
                    const link = this.plugin.settings.useAppURI ? `[link](todoist://task?id=${newTask.id})` : `[link](https://app.todoist.com/app/task/${newTask.id})`;
                    const text = this.plugin.taskParser.addTodoistLink(text_with_out_link, link);
                    lines[i] = text;

                    hasNewTask = true;

                } catch (error) {
                    console.error('Error adding task:', error);
                    continue;
                }
            }
        }
        if (hasNewTask) {
            try {
                const newContent = lines.join('\n');
                await this.plugin.backupOperation?.backupFile(filepath);
                await this.app.vault.modify(file, newContent);
            } catch (error) {
                console.error(error);
            }
        }
    }

    async lineModifiedTaskCheck(filepath: string, lineText: string, lineNumber: number, fileContent: string): Promise<void> {
        if (this.plugin.taskParser.hasTodoistId(lineText) && this.plugin.taskParser.hasTodoistTag(lineText)) {
            const lineTask = await this.plugin.taskParser.convertTextToTodoistTaskObject(lineText, filepath, lineNumber, fileContent);
            const lineTask_todoist_id = (lineTask.todoist_id).toString();

            const taskMapping = this.plugin.cacheOperation.getTaskFileMapping(lineTask_todoist_id);
            if (!taskMapping) {
                console.log(`Local cache has no task ${lineTask.todoist_id}`);
                const url = this.plugin.taskParser.getObsidianUrlFromFilepath(filepath);
                console.log(url);
                return;
            }

            const savedTask = await this.plugin.todoistSyncAPI.GetTaskById(lineTask_todoist_id);

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
                    console.log(`Content modified for task ${lineTask_todoist_id}`);
                    updatedContent.content = lineTaskContent;
                    contentChanged = true;
                }

                if (tagsModified) {
                    console.log(`Tags modified for task ${lineTask_todoist_id}`);
                    updatedContent.labels = lineTask.labels;
                    tagsChanged = true;
                }

                if (dueDateModified) {
                    console.log(`Due date modified for task ${lineTask_todoist_id}`);
                    console.log(lineTask.dueDate);
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
                    this.plugin.logOperation?.log('OBSIDIAN_TASK_MODIFIED', `Updated task: ${updatedTask.content}`, filepath, lineTask_todoist_id);
                    this.plugin.logOperation?.log('TODOIST_TASK_UPDATED', `Updated task in Todoist: ${updatedTask.content}`, filepath, lineTask_todoist_id);
                }

                if (statusModified) {
                    console.log(`Status modified for task ${lineTask_todoist_id}`);
                    if (lineTask.isCompleted === true) {
                        console.log(`task completed`);
                        await this.plugin.todoistSyncAPI.CloseTask(lineTask.todoist_id.toString());
                        // taskFileMapping already set, no need to update
                        this.plugin.logOperation?.log('OBSIDIAN_TASK_COMPLETED', `Completed task: ${lineTask.content}`, filepath, lineTask_todoist_id);
                        this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Completed task in Todoist: ${lineTask.content}`, filepath, lineTask_todoist_id);
                    } else {
                        console.log(`task uncompleted`);
                        await this.plugin.todoistSyncAPI.OpenTask(lineTask.todoist_id.toString());
                        // taskFileMapping already set, no need to update
                        this.plugin.logOperation?.log('OBSIDIAN_TASK_REOPENED', `Reopened task: ${lineTask.content}`, filepath, lineTask_todoist_id);
                        this.plugin.logOperation?.log('TODOIST_TASK_REOPENED', `Reopened task in Todoist: ${lineTask.content}`, filepath, lineTask_todoist_id);
                    }
                    statusChanged = true;
                }

                if (contentChanged || statusChanged || dueDateChanged || tagsChanged || priorityChanged) {
                    console.log(lineTask);
                    console.log(savedTask);
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
        try {
            await this.plugin.todoistSyncAPI.CloseTask(taskId);
            await this.plugin.fileOperation.completeTaskInTheFile(taskId);
            // taskFileMapping already set, no need to update
            this.plugin.saveSettings();
            new Notice(`Task ${taskId} is closed.`);
            this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Closed task via checkbox: ${taskId}`, undefined, taskId);
        } catch (error) {
            console.error('Error closing task:', error);
            throw error;
        }
    }

    async repoenTask(taskId: string): Promise<void> {
        try {
            await this.plugin.todoistSyncAPI.OpenTask(taskId);
            await this.plugin.fileOperation.uncompleteTaskInTheFile(taskId);
            // taskFileMapping already set, no need to update
            this.plugin.saveSettings();
            new Notice(`Task ${taskId} is reopend.`);
            this.plugin.logOperation?.log('TODOIST_TASK_REOPENED', `Reopened task via checkbox: ${taskId}`, undefined, taskId);
        } catch (error) {
            console.error('Error opening task:', error);
            throw error;
        }
    }

    async deleteTasksByIds(taskIds: string[]): Promise<string[]> {
        const deletedTaskIds: string[] = [];

        for (const taskId of taskIds) {
            const api = await this.plugin.todoistSyncAPI.initializeAPI();
            try {
                const response = await api.deleteTask(taskId);
                console.log(`response is ${response}`);

                if (response) {
                    new Notice(`Task ${taskId} is deleted.`);
                    this.plugin.logOperation?.log('OBSIDIAN_TASK_DELETED', `Deleted task: ${taskId}`, undefined, taskId);
                    this.plugin.logOperation?.log('TODOIST_TASK_DELETED', `Deleted task in Todoist: ${taskId}`, undefined, taskId);
                    deletedTaskIds.push(taskId);
                }
            } catch (error) {
                console.error(`Failed to delete task ${taskId}: ${error}`);
            }
        }

        if (!deletedTaskIds.length) {
            console.log("No tasks deleted");
            return [];
        }

        for (const taskId of deletedTaskIds) {
            this.plugin.cacheOperation.deleteTaskFileMapping(taskId);
        }
        this.plugin.saveSettings();

        return deletedTaskIds;
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
                    const description = `[[${filepath}]]`;
                    await this.plugin.todoistSyncAPI.UpdateTask(taskId, { description });
                    this.plugin.logOperation?.log('TODOIST_TASK_UPDATED', `Updated task description: ${taskId}`, filepath, taskId);
                }
            } catch (error) {
                console.error(`Error updating task description for ${taskId}:`, error);
            }
        }
    }
}
