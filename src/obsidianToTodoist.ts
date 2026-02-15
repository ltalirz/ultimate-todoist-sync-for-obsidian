import UltimateTodoistSyncForObsidian from "../main";
import { App, Editor, MarkdownView, Notice } from 'obsidian';

export class ObsidianToTodoistSync {
    app: App;
    plugin: UltimateTodoistSyncForObsidian;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    async deletedTaskCheck(file_path: string): Promise<void> {
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

        const frontMatter = await this.plugin.cacheOperation.getFileMetadata(filepath);
        if (!frontMatter || !frontMatter.todoistTasks) {
            console.log('frontmatter has no task');
            return;
        }

        const currentFileValueWithOutFrontMatter = currentFileValue.replace(/^---[\s\S]*?---\n/, '');
        const frontMatter_todoistTasks = frontMatter.todoistTasks;
        const frontMatter_todoistCount = frontMatter.todoistCount;

        const deleteTasksPromises = frontMatter_todoistTasks
            .filter((taskId: string) => !currentFileValueWithOutFrontMatter.includes(taskId))
            .map(async (taskId: string) => {
                try {
                    const api = this.plugin.todoistRestAPI.initializeAPI();
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
        const deletedTaskAmount = deletedTaskIds.length;
        if (!deletedTaskIds.length) {
            return;
        }
        this.plugin.cacheOperation.deleteTaskFromCacheByIDs(deletedTaskIds);
        this.plugin.saveSettings();

        const newFrontMatter_todoistTasks = frontMatter_todoistTasks.filter(
            (taskId: string) => !deletedTaskIds.includes(taskId)
        );

        const newFileMetadata = { todoistTasks: newFrontMatter_todoistTasks, todoistCount: (frontMatter_todoistCount - deletedTaskAmount) };
        await this.plugin.cacheOperation.updateFileMetadata(filepath, newFileMetadata);
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
                const newTask = await this.plugin.todoistRestAPI.AddTask(currentTask);
                const { id: todoist_id } = newTask;
                newTask.path = filepath;
                new Notice(`new task ${newTask.content} id is ${newTask.id}`);

                this.plugin.logOperation?.log('OBSIDIAN_TASK_CREATED', `Created task in Obsidian: ${newTask.content}`, filepath, todoist_id);
                this.plugin.logOperation?.log('TODOIST_TASK_CREATED', `Created task in Todoist: ${newTask.content}`, filepath, todoist_id);

                this.plugin.cacheOperation.appendTaskToCache(newTask);

                if (currentTask.isCompleted === true) {
                    await this.plugin.todoistRestAPI.CloseTask(newTask.id);
                    this.plugin.cacheOperation.closeTaskToCacheByID(todoist_id);
                    this.plugin.logOperation?.log('OBSIDIAN_TASK_COMPLETED', `Completed task in Obsidian: ${newTask.content}`, filepath, todoist_id);
                    this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Completed task in Todoist: ${newTask.content}`, filepath, todoist_id);
                }
                this.plugin.saveSettings();

                const text_with_out_link = `${linetxt} %%[todoist_id:: ${todoist_id}]%%`;
                const link = this.plugin.settings.useAppURI ? `[link](todoist://task?id=${newTask.id})` : `[link](${newTask.url})`;
                const text = this.plugin.taskParser.addTodoistLink(text_with_out_link, link);
                const from = { line: cursor.line, ch: 0 };
                const to = { line: cursor.line, ch: linetxt.length };
                view.app.workspace.activeEditor?.editor?.replaceRange(text, from, to);

                try {
                    const frontMatter = await this.plugin.cacheOperation.getFileMetadata(filepath);

                    if (!frontMatter) {
                        // empty
                    }

                    const newFrontMatter = { ...frontMatter };
                    newFrontMatter.todoistCount = (newFrontMatter.todoistCount ?? 0) + 1;
                    newFrontMatter.todoistTasks = [...(newFrontMatter.todoistTasks || []), todoist_id];

                    await this.plugin.cacheOperation.updateFileMetadata(filepath, newFrontMatter);

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

        let newFrontMatter;
        const frontMatter = await this.plugin.cacheOperation.getFileMetadata(filepath);

        if (!frontMatter) {
            console.log('frontmatter is empty');
            newFrontMatter = {};
        } else {
            newFrontMatter = { ...frontMatter };
        }

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
                    const newTask = await this.plugin.todoistRestAPI.AddTask(currentTask);
                    const { id: todoist_id } = newTask;
                    newTask.path = filepath;
                    console.log(newTask);
                    new Notice(`new task ${newTask.content} id is ${newTask.id}`);

                    this.plugin.cacheOperation.appendTaskToCache(newTask);

                    if (currentTask.isCompleted === true) {
                        await this.plugin.todoistRestAPI.CloseTask(newTask.id);
                        this.plugin.cacheOperation.closeTaskToCacheByID(todoist_id);
                    }
                    this.plugin.saveSettings();

                    const text_with_out_link = `${line} %%[todoist_id:: ${todoist_id}]%%`;
                    const link = `[link](${newTask.url})`;
                    const text = this.plugin.taskParser.addTodoistLink(text_with_out_link, link);
                    lines[i] = text;

                    newFrontMatter.todoistCount = (newFrontMatter.todoistCount ?? 0) + 1;
                    newFrontMatter.todoistTasks = [...(newFrontMatter.todoistTasks || []), todoist_id];

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
                await this.app.vault.modify(file, newContent);

                await this.plugin.cacheOperation.updateFileMetadata(filepath, newFrontMatter);

            } catch (error) {
                console.error(error);
            }
        }
    }

    async lineModifiedTaskCheck(filepath: string, lineText: string, lineNumber: number, fileContent: string): Promise<void> {
        if (this.plugin.settings.enableFullVaultSync) {
            const metadata = await this.plugin.cacheOperation.getFileMetadata(filepath);
            if (!metadata) {
                await this.plugin.cacheOperation.newEmptyFileMetadata(filepath);
            }
            this.plugin.saveSettings();
        }

        if (this.plugin.taskParser.hasTodoistId(lineText) && this.plugin.taskParser.hasTodoistTag(lineText)) {
            const lineTask = await this.plugin.taskParser.convertTextToTodoistTaskObject(lineText, filepath, lineNumber, fileContent);
            const lineTask_todoist_id = (lineTask.todoist_id).toString();

            const savedTask = await this.plugin.cacheOperation.loadTaskFromCacheyID(lineTask_todoist_id);
            if (!savedTask) {
                console.log(`Local cache has no task ${lineTask.todoist_id}`);
                const url = this.plugin.taskParser.getObsidianUrlFromFilepath(filepath);
                console.log(url);
                return;
            }

            const lineTaskContent = lineTask.content;
            const contentModified = !this.plugin.taskParser.taskContentCompare(lineTask, savedTask);
            const tagsModified = !this.plugin.taskParser.taskTagCompare(lineTask, savedTask);
            const projectModified = !(await this.plugin.taskParser.taskProjectCompare(lineTask, savedTask));
            const statusModified = !this.plugin.taskParser.taskStatusCompare(lineTask, savedTask);
            const dueDateModified = !(await this.plugin.taskParser.compareTaskDueDate(lineTask, savedTask));
            const parentIdModified = !(lineTask.parentId === savedTask.parentId);
            const priorityModified = !(lineTask.priority === savedTask.priority);

            try {
                let contentChanged = false;
                let tagsChanged = false;
                const projectChanged = false;
                let statusChanged = false;
                let dueDateChanged = false;
                const parentIdChanged = false;
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

                if (projectModified) {
                    // Project modification not supported by Todoist REST API
                }

                if (parentIdModified) {
                    // Parent ID modification not supported by Todoist REST API
                }

                if (priorityModified) {
                    updatedContent.priority = lineTask.priority;
                    priorityChanged = true;
                }

                if (contentChanged || tagsChanged || dueDateChanged || projectChanged || parentIdChanged || priorityChanged) {
                    const updatedTask = await this.plugin.todoistRestAPI.UpdateTask(lineTask.todoist_id.toString(), updatedContent);
                    updatedTask.path = filepath;
                    this.plugin.cacheOperation.updateTaskToCacheByID(updatedTask);
                    this.plugin.logOperation?.log('OBSIDIAN_TASK_MODIFIED', `Updated task: ${updatedTask.content}`, filepath, lineTask_todoist_id);
                    this.plugin.logOperation?.log('TODOIST_TASK_UPDATED', `Updated task in Todoist: ${updatedTask.content}`, filepath, lineTask_todoist_id);
                }

                if (statusModified) {
                    console.log(`Status modified for task ${lineTask_todoist_id}`);
                    if (lineTask.isCompleted === true) {
                        console.log(`task completed`);
                        await this.plugin.todoistRestAPI.CloseTask(lineTask.todoist_id.toString());
                        this.plugin.cacheOperation.closeTaskToCacheByID(lineTask_todoist_id.toString());
                        this.plugin.logOperation?.log('OBSIDIAN_TASK_COMPLETED', `Completed task: ${lineTask.content}`, filepath, lineTask_todoist_id);
                        this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Completed task in Todoist: ${lineTask.content}`, filepath, lineTask_todoist_id);
                    } else {
                        console.log(`task uncompleted`);
                        await this.plugin.todoistRestAPI.OpenTask(lineTask.todoist_id.toString());
                        this.plugin.cacheOperation.reopenTaskToCacheByID(lineTask.todoist_id.toString());
                        this.plugin.logOperation?.log('OBSIDIAN_TASK_REOPENED', `Reopened task: ${lineTask.content}`, filepath, lineTask_todoist_id);
                        this.plugin.logOperation?.log('TODOIST_TASK_REOPENED', `Reopened task in Todoist: ${lineTask.content}`, filepath, lineTask_todoist_id);
                    }
                    statusChanged = true;
                }

                if (contentChanged || statusChanged || dueDateChanged || tagsChanged || projectChanged || priorityChanged) {
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
                    if (projectChanged) {
                        message += " Project was changed.";
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
            let hasModifiedTask = false;
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (this.plugin.taskParser.hasTodoistId(line) && this.plugin.taskParser.hasTodoistTag(line)) {
                    try {
                        await this.lineModifiedTaskCheck(filepath, line, i, content);
                        hasModifiedTask = true;
                    } catch (error) {
                        console.error('Error modifying task:', error);
                        continue;
                    }
                }
            }

            if (hasModifiedTask) {
                try {
                    // Perform necessary actions on the modified content and front matter
                } catch (error) {
                    console.error('Error processing modified content:', error);
                }
            }
        } catch (error) {
            console.error('Error:', error);
        }
    }

    async closeTask(taskId: string): Promise<void> {
        try {
            await this.plugin.todoistRestAPI.CloseTask(taskId);
            await this.plugin.fileOperation.completeTaskInTheFile(taskId);
            await this.plugin.cacheOperation.closeTaskToCacheByID(taskId);
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
            await this.plugin.todoistRestAPI.OpenTask(taskId);
            await this.plugin.fileOperation.uncompleteTaskInTheFile(taskId);
            await this.plugin.cacheOperation.reopenTaskToCacheByID(taskId);
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
            const api = await this.plugin.todoistRestAPI.initializeAPI();
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

        await this.plugin.cacheOperation.deleteTaskFromCacheByIDs(deletedTaskIds);
        this.plugin.saveSettings();

        return deletedTaskIds;
    }

    async updateTaskDescription(filepath: string): Promise<void> {
        const metadata = await this.plugin.cacheOperation.getFileMetadata(filepath);

        if (!metadata || !metadata.todoistTasks) {
            return;
        }

        const todoistTasks = metadata.todoistTasks;

        for (const taskId of todoistTasks) {
            try {
                const task = await this.plugin.cacheOperation.loadTaskFromCacheyID(taskId);
                if (task) {
                    const description = `[[${filepath}]]`;
                    await this.plugin.todoistRestAPI.UpdateTask(taskId, { description });
                    this.plugin.logOperation?.log('TODOIST_TASK_UPDATED', `Updated task description: ${taskId}`, filepath, taskId);
                }
            } catch (error) {
                console.error(`Error updating task description for ${taskId}:`, error);
            }
        }
    }
}
