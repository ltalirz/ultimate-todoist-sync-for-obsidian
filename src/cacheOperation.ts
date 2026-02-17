import { App} from 'obsidian';
import UltimateTodoistSyncForObsidian from "../main";
import { TaskConflict, ConflictResolutionModal } from './conflictModal';

interface Due {
    date?: string;
    [key: string]: any;
}

export interface DatabaseCheckIssue {
    type: 
        | 'task_deleted_in_todoist'
        | 'missing_in_cache'
        | 'new_task_not_synced'
        | 'file_reference_missing'
        | 'orphaned_in_cache'
        | 'task_not_in_vault'
        | 'content_mismatch'
        | 'cache_content_outdated'
        | 'status_mismatch'
        | 'cache_status_outdated'
        | 'duedate_mismatch'
        | 'duplicate_task'
        | 'priority_mismatch'
        | 'label_mismatch'
        | 'project_mismatch'
        | 'empty_metadata';
    filePath?: string;
    taskId?: string;
    details: string;
    taskContent?: string;
    obsidianContent?: string;
    todoistContent?: string;
    cacheContent?: string;
    obsidianStatus?: boolean;
    todoistStatus?: boolean;
    cacheStatus?: boolean;
    dueDate?: string;
    cacheDueDate?: string;
    priority?: number;
    cachePriority?: number;
    projectId?: string;
    cacheProjectId?: string;
    projectName?: string;
    lineNumber?: number;
    labels?: string[];
    cacheLabels?: string[];
}

export interface DatabaseCheckResult {
    success: boolean;
    totalIssues: number;
    issues: DatabaseCheckIssue[];
    summary: {
        taskDeletedInTodoist: number;
        missingInCache: number;
        newTaskNotSynced: number;
        fileReferenceMissing: number;
        orphanedInCache: number;
        taskNotInVault: number;
        contentMismatch: number;
        cacheContentOutdated: number;
        statusMismatch: number;
        cacheStatusOutdated: number;
        duedateMismatch: number;
        duplicateTask: number;
        priorityMismatch: number;
        labelMismatch: number;
        projectMismatch: number;
        emptyMetadata: number;
    };
    reportPath?: string;
}

export class CacheOperation   {
	app:App;
    plugin: UltimateTodoistSyncForObsidian;

	constructor(app:App, plugin: UltimateTodoistSyncForObsidian) {
		//super(app,settings);
		this.app = app;
        this.plugin = plugin;
	}

          
      
      
      
    async getFileMetadata(filepath:string) {
        return this.plugin.settings.fileMetadata[filepath] ?? null
    }

    async getFileMetadatas(){
        return this.plugin.settings.fileMetadata ?? null
    }

    async newEmptyFileMetadata(filepath:string){
        const metadatas = this.plugin.settings.fileMetadata
        if(metadatas[filepath]) {
            return
        }
        else{
            metadatas[filepath] = {}
        }
        metadatas[filepath].todoistTasks = [];
        metadatas[filepath].todoistCount = 0;
        // 将更新后的metadatas对象保存回设置对象中
        this.plugin.settings.fileMetadata = metadatas

    }

    async updateFileMetadata(filepath:string,newMetadata) {
        const metadatas = this.plugin.settings.fileMetadata
    
        // 如果元数据对象不存在，则创建一个新的对象并添加到metadatas中
        if (!metadatas[filepath]) {
            metadatas[filepath] = {}
        }
    
        // 更新元数据对象中的属性值
        metadatas[filepath].todoistTasks = newMetadata.todoistTasks;
        metadatas[filepath].todoistCount = newMetadata.todoistCount;
    
        // 将更新后的metadatas对象保存回设置对象中
        this.plugin.settings.fileMetadata = metadatas
        this.plugin.logOperation?.log('CACHE_FILE_METADATA_UPDATED', `Updated file metadata for: ${filepath}`, filepath);
        
    }

    async deleteTaskIdFromMetadata(filepath:string,taskId:string){
        console.log(filepath)
        const metadata = await this.getFileMetadata(filepath)
        console.log(metadata)
        const newTodoistTasks = metadata.todoistTasks.filter(function(element){
            return element !== taskId
        })
        const newTodoistCount = metadata.todoistCount - 1
        let newMetadata = {}
        newMetadata.todoistTasks = newTodoistTasks
        newMetadata.todoistCount = newTodoistCount
        console.log(`new metadata ${newMetadata}`)
        

    }

    //delete filepath from filemetadata
    async deleteFilepathFromMetadata(filepath:string){
        Reflect.deleteProperty(this.plugin.settings.fileMetadata, filepath);
        this.plugin.saveSettings()
        this.plugin.logOperation?.log('CACHE_FILE_METADATA_DELETED', `Deleted file metadata for: ${filepath}`, filepath);
        console.log(`${filepath} is deleted from file metadatas.`)
    }

    // TaskFileMapping methods - replaces todoistTasksData.tasks
    getTaskFileMapping(taskId: string): { filePath: string; lineNumber: number } | null {
        return this.plugin.settings.taskFileMapping[taskId] ?? null;
    }

    setTaskFileMapping(taskId: string, filePath: string, lineNumber: number): void {
        this.plugin.settings.taskFileMapping[taskId] = { filePath, lineNumber };
    }

    deleteTaskFileMapping(taskId: string): void {
        delete this.plugin.settings.taskFileMapping[taskId];
    }

    getAllTaskFileMappings(): { [taskId: string]: { filePath: string; lineNumber: number } } {
        return this.plugin.settings.taskFileMapping ?? {};
    }


    //Check errors in filemata where the filepath is incorrect.
    async checkFileMetadata(){
        const metadatas =  await this.getFileMetadatas()
        for (const key in metadatas) {
            let filepath = key
            const value = metadatas[key];
            let file = this.app.vault.getAbstractFileByPath(key)
            if(!file && (value.todoistTasks?.length === 0 || !value.todoistTasks)){
                console.log(`${key} is not existed and metadata is empty.`)
                await this.deleteFilepathFromMetadata(key)
                continue
            }
            if(value.todoistTasks?.length === 0 || !value.todoistTasks){
                //todo 
                //delelte empty metadata
                continue
            }
            //check if file exist
            
            if(!file){
                //search new filepath
                console.log(`file ${filepath} is not exist`) 
                const todoistId1 = value.todoistTasks[0]
                console.log(todoistId1)
                const searchResult = await this.plugin.fileOperation.searchFilepathsByTaskidInVault(todoistId1)
                console.log(`new file path is`)
                console.log(searchResult)

                //update metadata
                await this.updateRenamedFilePath(filepath,searchResult)
                this.plugin.saveSettings()

            }


            //const fileContent = await this.app.vault.read(file)
            //check if file include all tasks


            /*
            value.todoistTasks.forEach(async(taskId) => {
                const taskObject = await this.plugin.cacheOperation.loadTaskFromCacheyID(taskId)


            });
            */
          }
    
    }

    // Helper function to get all file metadatas
    getDefaultProjectNameForFilepath(filepath: string): string {
        const metadatas = this.plugin.settings.fileMetadata;
        if (!metadatas[filepath] || metadatas[filepath].defaultProjectId === undefined) {
            return this.plugin.settings.defaultProjectName;
        } else {
            const defaultProjectId = metadatas[filepath].defaultProjectId;
            const project = this.plugin.todoistSyncAPI.getSyncData()?.projects?.find((p: any) => p.id === defaultProjectId);
            return project?.name || this.plugin.settings.defaultProjectName;
        }
    }


    getDefaultProjectIdForFilepath(filepath:string){
        const metadatas = this.plugin.settings.fileMetadata
        if (!metadatas[filepath] || metadatas[filepath].defaultProjectId === undefined) {
            return this.plugin.settings.defaultProjectId
        }
        else{
            const defaultProjectId = metadatas[filepath].defaultProjectId
            return defaultProjectId
        }
    }

    setDefaultProjectIdForFilepath(filepath:string,defaultProjectId:string){
        const metadatas = this.plugin.settings.fileMetadata
        if (!metadatas[filepath]) {
            metadatas[filepath] = {}
        }
        metadatas[filepath].defaultProjectId = defaultProjectId
    
        // 将更新后的metadatas对象保存回设置对象中
        this.plugin.settings.fileMetadata = metadatas

    }

      
    // DEPRECATED: Using syncData from Todoist API instead - no longer needed
    loadTasksFromCache() {
        return [];
    }

    // DEPRECATED: Using syncData from Todoist API instead - no longer needed
    saveTasksToCache(_newTasks: any): boolean {
        return true;
    }

    // DEPRECATED: Event tracking no longer needed for one-way sync
    appendEventToCache(_event: Object[]): void {}
    appendEventsToCache(_events: Object[]): void {}
    loadEventsFromCache(): any[] { return []; }
    appendTaskToCache(_task: any): void {}
    loadTaskFromCacheyID(_taskId: string): any { return null; }
    updateTaskToCacheByID(_task: any): void {}
    modifyTaskToCacheByID(_taskId: string, _params: { content?: string, due?: Due }): void {}
    reopenTaskToCacheByID(_taskId: string): void {}
    closeTaskToCacheByID(_taskId: string): void {}
    deleteTaskFromCache(_taskId: string): void {}
    deleteTaskFromCacheByIDs(_deletedTaskIds: string[]): void {}

    // DEPRECATED: Using todoistSyncAPI.getProjectByName instead
    getProjectIdByNameFromCache(projectName: string): any {
        return this.plugin.todoistSyncAPI.getSyncData()?.projects?.find((p: any) => p.name === projectName)?.id || null;
    }

    // DEPRECATED: Using todoistSyncAPI.getProjectById instead
    getProjectNameByIdFromCache(projectId: string): any {
        return this.plugin.todoistSyncAPI.getSyncData()?.projects?.find((p: any) => p.id === projectId)?.name || null;
    }

    // DEPRECATED: Using syncData from Todoist API instead
    async saveProjectsToCache(): Promise<boolean> { return true; }

    // DEPRECATED: Using taskFileMapping instead
    async updateRenamedFilePath(oldpath: string, newpath: string): Promise<void> {
        const taskFileMapping = this.plugin.settings.taskFileMapping || {};
        const fileMetadata = this.plugin.settings.fileMetadata || {};
        for (const [taskId, mapping] of Object.entries(taskFileMapping)) {
            if (mapping.filePath === oldpath) {
                taskFileMapping[taskId] = { ...mapping, filePath: newpath };
            }
        }
        this.plugin.settings.taskFileMapping = taskFileMapping;
        if (fileMetadata[oldpath]) {
            fileMetadata[newpath] = fileMetadata[oldpath];
            delete fileMetadata[oldpath];
            this.plugin.settings.fileMetadata = fileMetadata;
        }
        this.plugin.logOperation?.log('CACHE_RENAMED', `Renamed file path from ${oldpath} to ${newpath}`, newpath);
    }

    async rebuildCache(noticeCallback?: (message: string) => void): Promise<{ success: boolean; tasksProcessed: number }> {
        try {
            if (noticeCallback) {
                noticeCallback('Starting cache rebuild...');
            } else {
                console.log('Starting cache rebuild...');
            }
            this.plugin.logOperation?.log('CACHE_REBUILT', 'Starting cache rebuild...');

            // Step 1: 清空现有缓存
            this.plugin.settings.todoistTasksData = {
                projects: [],
                tasks: [],
                events: []
            };
            this.plugin.settings.fileMetadata = {};

            // Step 2: 从 Todoist 获取项目列表
            if (noticeCallback) {
                noticeCallback('Fetching projects from Todoist...');
            } else {
                console.log('Fetching projects from Todoist...');
            }
            const projects = await this.plugin.todoistSyncAPI.GetAllProjects();
            if (!projects) {
                throw new Error('Failed to fetch projects from Todoist');
            }
            this.plugin.settings.todoistTasksData.projects = projects;

            // Step 3: 扫描 Vault 中的所有 .md 文件
            if (noticeCallback) {
                noticeCallback('Scanning vault for tasks...');
            } else {
                console.log('Scanning vault for tasks...');
            }
            
            const files = this.app.vault.getFiles()
                .filter(f => f.extension === 'md');
            
            const fileTaskMap: Map<string, { taskId: string; lineNumber: number; content: string; isCompleted: boolean }[]> = new Map();
            
            for (const file of files) {
                try {
                    const content = await this.app.vault.cachedRead(file);
                    const lines = content.split('\n');
                    
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        // 检查是否包含 #todoist 标签
                        if (line.includes('#todoist')) {
                            // 提取 todoist_id: %%[todoist_id:: xxx]%%
                            const match = line.match(/%%\[todoist_id::\s*(\w+)\]%%/);
                            if (match && match[1]) {
                                const taskId = match[1];
                                // 提取任务内容（去掉 checkbox 和 metadata）
                                const taskContent = this.extractTaskContent(line);
                                // 检查任务完成状态 - [x] 表示完成, [ ] 表示未完成
                                const isCompleted = /\[x\]/i.test(line);
                                
                                if (!fileTaskMap.has(file.path)) {
                                    fileTaskMap.set(file.path, []);
                                }
                                fileTaskMap.get(file.path)!.push({
                                    taskId,
                                    lineNumber: i,
                                    content: taskContent,
                                    isCompleted
                                });
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Error reading file ${file.path}:`, error);
                }
            }

            // Step 4: 处理每个文件的任务，检测冲突
            if (noticeCallback) {
                noticeCallback('Processing tasks and detecting conflicts...');
            } else {
                console.log('Processing tasks and detecting conflicts...');
            }
            
            const conflicts: TaskConflict[] = [];
            let processedCount = 0;
            const totalTasks = Array.from(fileTaskMap.values())
                .reduce((sum, tasks) => sum + tasks.length, 0);
            
            // 用于记录无效的 taskId（Todoist 中不存在的）
            const invalidTaskIds: string[] = [];
            
            for (const [filePath, fileTasks] of fileTaskMap.entries()) {
                const validTaskIds: string[] = [];
                
                for (const taskInfo of fileTasks) {
                    try {
                        // 从 Todoist 获取任务详情
                        const task = await this.plugin.todoistSyncAPI.getTaskById(taskInfo.taskId);
                        
                        // 比较内容是否一致
                        const todoistContent = task.content || '';
                        const obsidianContent = taskInfo.content;
                        
                        // 检查完成状态是否一致
                        // Todoist API: task.isCompleted 表示完成状态
                        const todoistIsCompleted = task.isCompleted || false;
                        const obsidianIsCompleted = taskInfo.isCompleted;
                        
                        // 检测内容冲突
                        const contentConflict = obsidianContent.trim() !== todoistContent.trim();
                        // 检测完成状态冲突
                        const statusConflict = obsidianIsCompleted !== todoistIsCompleted;
                        
                        if (contentConflict || statusConflict) {
                            // 检测到冲突
                            conflicts.push({
                                taskId: taskInfo.taskId,
                                filePath: filePath,
                                obsidianContent: obsidianContent,
                                todoistContent: todoistContent,
                                lineNumber: taskInfo.lineNumber
                            });
                        }
                        
                        // 添加 path 字段关联到文件
                        // 同时保存完成状态
                        (task as any).path = filePath;
                        (task as any).isCompleted = todoistIsCompleted;
                        
                        // 保存到缓存
                        this.appendTaskToCache(task);
                        
                        validTaskIds.push(taskInfo.taskId);
                        processedCount++;
                        
                        // 每处理 10 个任务更新一次 UI
                        if (noticeCallback && processedCount % 10 === 0) {
                            noticeCallback(`Processing ${processedCount}/${totalTasks}...`);
                        }
                    } catch (error) {
                        // 任务在 Todoist 中不存在，记录下来
                        console.log(`Task ${taskInfo.taskId} not found in Todoist, will be removed from metadata...`);
                        invalidTaskIds.push(taskInfo.taskId);
                        // 记录日志
                        this.plugin.logOperation?.log('CACHE_TASK_DELETED', `Task ${taskInfo.taskId} not found in Todoist during rebuild, removing from cache`, filePath, taskInfo.taskId);
                    }
                }
                
                // 更新 fileMetadata（排除无效的 taskId）
                const finalTaskIds = validTaskIds.filter(id => !invalidTaskIds.includes(id));
                if (finalTaskIds.length > 0) {
                    this.plugin.settings.fileMetadata[filePath] = {
                        todoistTasks: finalTaskIds,
                        todoistCount: finalTaskIds.length
                    };
                }
            }

            // Step 5: 如果有冲突，弹出窗口让用户选择
            if (conflicts.length > 0) {
                if (noticeCallback) {
                    noticeCallback(`Found ${conflicts.length} conflicts. Please resolve in dialog...`);
                }
                
                await new Promise<void>((resolve) => {
                    new ConflictResolutionModal(
                        this.app,
                        this.plugin,
                        conflicts,
                        async (resolutions) => {
                            await this.resolveConflicts(resolutions, conflicts);
                            // 解决冲突后，重新更新 fileMetadata
                            for (const conflict of conflicts) {
                                const resolution = resolutions.get(conflict.taskId);
                                if (resolution === 'todoist') {
                                    // 如果选择保留 Todoist 内容，需要重新保存任务到缓存以更新完成状态
                                    try {
                                        const task = await this.plugin.todoistSyncAPI.getTaskById(conflict.taskId);
                                        (task as any).path = conflict.filePath;
                                        (task as any).isCompleted = task.isCompleted;
                                        this.plugin.cacheOperation.updateTaskToCacheByID(task);
                                    } catch (error) {
                                        console.error(`Failed to update task ${conflict.taskId} after conflict resolution:`, error);
                                    }
                                }
                            }
                            resolve();
                        }
                    );
                });
            }
            
            // Step 6: 保存设置
            await this.plugin.saveSettings();
            
            const invalidMsg = invalidTaskIds.length > 0 ? ` (${invalidTaskIds.length} tasks not found in Todoist removed)` : '';
            const conflictMsg = conflicts.length > 0 ? ` (${conflicts.length} conflicts resolved)` : '';
            const message = `Cache rebuilt! ${processedCount} tasks processed.${invalidMsg}${conflictMsg}`;
            this.plugin.logOperation?.log('CACHE_REBUILT', `Cache rebuilt successfully! ${processedCount} tasks processed.${invalidMsg}${conflictMsg}`);
            if (noticeCallback) {
                noticeCallback(message);
            } else {
                console.log(message);
            }
            
            return { success: true, tasksProcessed: processedCount };
            
        } catch (error) {
            console.error('Cache rebuild failed:', error);
            this.plugin.logOperation?.log('CACHE_REBUILT', `Cache rebuild failed: ${(error as Error).message}`);
            const message = `Cache rebuild failed: ${(error as Error).message}`;
            if (noticeCallback) {
                noticeCallback(message);
            }
            return { success: false, tasksProcessed: 0 };
        }
    }

    private extractTaskContent(line: string): string {
        // 去掉 checkbox 标记 [- ] 或 [x]
        let content = line.replace(/^(\s*)([-*])\s+\[(x|X| )\]\s*/, '');
        // 去掉 #todoist 标签
        content = content.replace(/#todoist/g, '').trim();
        // 去掉 todoist_id 元数据
        content = content.replace(/%%\[todoist_id::\s*\w+\]%%/g, '').trim();
        // 去掉 link
        content = content.replace(/\[link\]\([^)]+\)/g, '').trim();
        // 去掉日期
        // eslint-disable-next-line no-misleading-character-class
        content = content.replace(/[🗓️📅📆🗓]\s*\d{4}-\d{2}-\d{2}/gu, '').trim();
        // 去掉优先级 !!1 !!2 !!3 !!4
        content = content.replace(/\s!![1-4]\s/g, ' ').trim();
        
        return content;
    }

    private async resolveConflicts(resolutions: Map<string, ConflictResolution>, conflicts: TaskConflict[]): Promise<void> {
        for (const conflict of conflicts) {
            const resolution = resolutions.get(conflict.taskId);
            
            if (resolution === 'obsidian') {
                // 用 Obsidian 内容更新 Todoist
                try {
                    await this.plugin.todoistSyncAPI.UpdateTask(conflict.taskId, {
                        content: conflict.obsidianContent
                    });
                    this.plugin.logOperation?.log('TODOIST_TASK_UPDATED', `Updated task ${conflict.taskId} with Obsidian content`, conflict.filePath, conflict.taskId);
                } catch (error) {
                    console.error(`Failed to update task ${conflict.taskId}:`, error);
                }
            } else if (resolution === 'todoist') {
                // 用 Todoist 内容更新 Obsidian 文件
                try {
                    const file = this.app.vault.getAbstractFileByPath(conflict.filePath);
                    if (file) {
                        const content = await this.app.vault.read(file);
                        const lines = content.split('\n');
                        
                        // 找到对应行并替换内容
                        if (lines[conflict.lineNumber]) {
                            const oldContent = this.extractTaskContent(lines[conflict.lineNumber]);
                            lines[conflict.lineNumber] = lines[conflict.lineNumber].replace(
                                oldContent,
                                conflict.todoistContent
                            );
                            await this.plugin.backupOperation?.backupFile(conflict.filePath);
                            await this.app.vault.modify(file, lines.join('\n'));
                            this.plugin.logOperation?.log('FILE_TASK_CONTENT_SYNCED', `Synced task ${conflict.taskId} from Todoist to file`, conflict.filePath, conflict.taskId);
                        }
                    }
                } catch (error) {
                    console.error(`Failed to update file ${conflict.filePath}:`, error);
                }
            }
            // 如果是 skip，则不做任何操作
        }
    }

}
