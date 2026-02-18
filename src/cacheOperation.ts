/**
 * ==========================================================================================
 * CacheOperation 模块 - 任务缓存与重建核心逻辑
 * ==========================================================================================
 * 
 * 【模块职责】
 * 本模块负责管理 Obsidian 与 Todoist 之间的任务缓存数据，包括：
 * 1. fileMetadata - 每个文件的元数据（包含该文件的 Todoist 任务列表）
 * 2. taskFileMapping - 任务ID到文件路径的映射（taskId -> {filePath, lineNumber}）
 * 3. rebuildCache - 重建缓存的核心方法，用于扫描 Vault 并与 Todoist 同步
 * 
 * 【数据结构】
 * - fileMetadata: { [filepath]: { todoistTasks: string[], todoistCount: number, defaultProjectId?: string } }
 *   存储每个 markdown 文件的 Todoist 任务列表
 * 
 * - taskFileMapping: { [taskId]: { filePath: string, lineNumber: number } }
 *   存储每个任务ID对应的文件位置，用于双向同步定位
 * 
 * 【重建缓存流程】
 * Step 1: 清空 taskFileMapping（保留 fileMetadata）
 * Step 2: 确保 syncData 已加载（从 Todoist API 获取最新数据）
 * Step 3: 扫描 Vault 中所有 .md 文件，查找带有 #todoist 标签的任务
 * Step 3.5: 检测并转换 legacy ID（旧的数字ID -> 新的字符串ID）
 * Step 4: 遍历每个任务，与 Todoist 对比，检测冲突
 * Step 5: 弹出冲突解决对话框
 * Step 6: 保存设置
 * 
 * 【冲突类型】
 * - contentConflict: Obsidian 任务内容与 Todoist 不一致
 * - statusConflict: 完成状态不一致
 * 
 * ==========================================================================================
 */

import { App} from 'obsidian';
import UltimateTodoistSyncForObsidian from "../main";
import { TaskConflict, ConflictResolutionModal } from './conflictModal';

/**
 * ==========================================================================================
 * 接口定义 - 数据库检查结果类型
 * ==========================================================================================
 * 
 * 【DatabaseCheckIssue】
 * 数据库检查问题类型，包含以下几种：
 * - task_deleted_in_todoist: 任务在 Todoist 端被删除
 * - missing_in_cache: 缓存中缺少任务
 * - new_task_not_synced: 新任务未同步
 * - file_reference_missing: 文件引用丢失
 * - orphaned_in_cache: 缓存中存在孤立任务
 * - task_not_in_vault: 任务在 Vault 中不存在
 * - content_mismatch: 内容不匹配
 * - cache_content_outdated: 缓存内容过时
 * - status_mismatch: 状态不匹配
 * - cache_status_outdated: 缓存状态过时
 * - duedate_mismatch: 截止日期不匹配
 * - duplicate_task: 重复任务
 * - priority_mismatch: 优先级不匹配
 * - label_mismatch: 标签不匹配
 * - project_mismatch: 项目不匹配
 * - empty_metadata: 空元数据
 * 
 * 【DatabaseCheckResult】
 * 数据库检查结果，包含：
 * - success: 检查是否成功
 * - totalIssues: 问题总数
 * - issues: 问题列表
 * - summary: 各类问题的统计
 * - reportPath: 报告文件路径
 * 
 * ==========================================================================================
 */

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

/**
 * ==========================================================================================
 * CacheOperation 类
 * ==========================================================================================
 * 
 * 【职责】
 * - 管理 fileMetadata 和 taskFileMapping 的 CRUD 操作
 * - 执行 rebuildCache 重建缓存流程
 * - 提供冲突检测和解决逻辑
 * 
 * 【依赖】
 * - this.app: Obsidian Vault 实例
 * - this.plugin: 主插件实例 (UltimateTodoistSyncForObsidian)
 *   - plugin.settings: 插件设置（包含 fileMetadata, taskFileMapping）
 *   - plugin.todoistSyncAPI: Todoist 同步 API
 *   - plugin.taskParser: 任务解析器
 *   - plugin.fileOperation: 文件操作
 *   - plugin.logOperation: 日志操作
 * 
 * ==========================================================================================
 */

export class CacheOperation   {
	app:App;
    plugin: UltimateTodoistSyncForObsidian;

    /**
     * 构造函数
     * @param app - Obsidian Vault 实例
     * @param plugin - 主插件实例
     */
	constructor(app:App, plugin: UltimateTodoistSyncForObsidian) {
		this.app = app;
        this.plugin = plugin;
	}
/**
 * ==========================================================================================
 * FileMetadata 方法组
 * ==========================================================================================
 * 
 * 【fileMetadata 数据结构】
 * {
 *   "filepath.md": {
 *     todoistTasks: ["taskId1", "taskId2"],  // 该文件包含的 Todoist 任务 ID 列表
 *     todoistCount: 2,                        // 任务数量
 *     defaultProjectId: "project123"         // 可选，默认项目 ID
 *   }
 * }
 * 
 * 【作用】
 * - 记录每个 Markdown 文件包含哪些 Todoist 任务
 * - 用于快速查找文件中的任务，以及文件重命名时更新映射
 * 
 * ==========================================================================================
 */

       
       
       
       
    /**
     * 获取指定文件的元数据
     * @param filepath - 文件路径
     * @returns 文件元数据对象，如果不存在则返回 null
     */
    async getFileMetadata(filepath:string) {
        // 从插件设置中获取 fileMetadata，然后查找对应 filepath 的元数据
        return this.plugin.settings.fileMetadata[filepath] ?? null
    }

    /**
     * 获取所有文件的元数据
     * @returns 全部 fileMetadata 对象
     */
    async getFileMetadatas(){
        return this.plugin.settings.fileMetadata ?? null
    }

    /**
     * 为指定文件创建新的空元数据
     * @param filepath - 文件路径
     * 
     * 【使用场景】
     * - 当首次在文件中添加 Todoist 任务时调用
     * - 初始化 todoistTasks 为空数组，todoistCount 为 0
     */
    async newEmptyFileMetadata(filepath:string){
        const metadatas = this.plugin.settings.fileMetadata
        // 如果元数据已存在，则不创建
        if(metadatas[filepath]) {
            return
        }
        else{
            metadatas[filepath] = {}
        }
        // 初始化空任务列表
        metadatas[filepath].todoistTasks = [];
        metadatas[filepath].todoistCount = 0;
        // 将更新后的 metadatas 对象保存回设置对象中
        this.plugin.settings.fileMetadata = metadatas

    }

    /**
     * 更新指定文件的元数据
     * @param filepath - 文件路径
     * @param newMetadata - 新的元数据对象（必须包含 todoistTasks 和 todoistCount）
     * 
     * 【使用场景】
     * - 当文件中的任务列表发生变化时调用（添加/删除任务）
     * - 同时会记录操作日志
     */
    async updateFileMetadata(filepath:string,newMetadata) {
        const metadatas = this.plugin.settings.fileMetadata
    
        // 如果元数据对象不存在，则创建一个新的对象并添加到 metadatas 中
        if (!metadatas[filepath]) {
            metadatas[filepath] = {}
        }
    
        // 更新元数据对象中的属性值
        metadatas[filepath].todoistTasks = newMetadata.todoistTasks;
        metadatas[filepath].todoistCount = newMetadata.todoistCount;
    
        // 将更新后的 metadatas 对象保存回设置对象中
        this.plugin.settings.fileMetadata = metadatas
        this.plugin.logOperation?.log('CACHE_FILE_METADATA_UPDATED', `Updated file metadata for: ${filepath}`, filepath);
        
    }

    /**
     * 从文件元数据中删除指定任务 ID
     * @param filepath - 文件路径
     * @param taskId - 要删除的任务 ID
     * 
     * 【注意】
     * 此方法只是从 todoistTasks 数组中过滤掉指定 ID，
     * 但并没有调用 saveSettings() 保存更改，可能需要调用者手动保存
     */
    async deleteTaskIdFromMetadata(filepath:string, taskId:string){
        console.log(filepath)
        const metadata = await this.getFileMetadata(filepath)
        console.log(metadata)
        // 过滤掉指定的任务 ID
        const newTodoistTasks = metadata.todoistTasks.filter(function(element){
            return element !== taskId
        })
        const newTodoistCount = metadata.todoistCount - 1
        let newMetadata = {}
        newMetadata.todoistTasks = newTodoistTasks
        newMetadata.todoistCount = newTodoistCount
        console.log(`new metadata ${newMetadata}`)
        

    }

    /**
     * 删除指定文件的元数据
     * @param filepath - 文件路径
     * 
     * 【使用场景】
     * - 当文件被删除时调用
     * - 同时会记录操作日志
     */
    //delete filepath from filemetadata
    async deleteFilepathFromMetadata(filepath:string){
        Reflect.deleteProperty(this.plugin.settings.fileMetadata, filepath);
        this.plugin.saveSettings()
        this.plugin.logOperation?.log('CACHE_FILE_METADATA_DELETED', `Deleted file metadata for: ${filepath}`, filepath);
        console.log(`${filepath} is deleted from file metadatas.`)
    }

    // ==========================================================================================
    // getFileMetadatas - 获取所有文件元数据
    // ==========================================================================================
    // ==========================================================================================

    // [已移动到上方]

    // ==========================================================================================
    // TaskFileMapping 方法组
    // ==========================================================================================
    //     let newMetadata = {}
    //     newMetadata.todoistTasks = newTodoistTasks
    //     newMetadata.todoistCount = newTodoistCount
    //     console.log(`new metadata ${newMetadata}`)
    // }

    // ==========================================================================================
    // TaskFileMapping 方法组
    // ==========================================================================================
    // 
    // 【taskFileMapping 数据结构】
    // {
    //   "taskId123": { filePath: "folder/file.md", lineNumber: 5 },
    //   "taskId456": { filePath: "folder/file2.md", lineNumber: 10 }
    // }
    // 
    // 【作用】
    // - 存储每个 Todoist 任务 ID 对应的 Obsidian 文件位置
    // - 用于双向同步时定位任务在 Vault 中的位置
    // - 当任务在 Todoist 端发生变化时，需要通过此映射更新 Obsidian 文件
    // 
    // ==========================================================================================

    /**
     * 获取指定任务 ID 的文件映射
     * @param taskId - Todoist 任务 ID
     * @returns 文件路径和行号，如果不存在则返回 null
     */
    getTaskFileMapping(taskId: string): { filePath: string; lineNumber: number } | null {
        return this.plugin.settings.taskFileMapping[taskId] ?? null;
    }

    /**
     * 设置任务 ID 到文件位置的映射
     * @param taskId - Todoist 任务 ID
     * @param filePath - Obsidian 文件路径
     * @param lineNumber - 任务所在行号
     */
    setTaskFileMapping(taskId: string, filePath: string, lineNumber: number): void {
        this.plugin.settings.taskFileMapping[taskId] = { filePath, lineNumber };
    }

    /**
     * 删除指定任务 ID 的文件映射
     * @param taskId - Todoist 任务 ID
     */
    deleteTaskFileMapping(taskId: string): void {
        delete this.plugin.settings.taskFileMapping[taskId];
    }

    /**
     * 获取所有任务 ID 到文件位置的映射
     * @returns 完整的 taskFileMapping 对象
     */
    getAllTaskFileMappings(): { [taskId: string]: { filePath: string; lineNumber: number } } {
        return this.plugin.settings.taskFileMapping ?? {};
    }


    // ==========================================================================================
    // checkFileMetadata - 检查文件元数据错误
    // ==========================================================================================
    // 
    // 【功能】
    // 遍历所有 fileMetadata，检查：
    // 1. 文件是否仍然存在（不存在且元数据为空则删除）
    // 2. 文件是否被重命名（不存在但有任务则尝试查找新路径）
    // 
    // 【流程】
    // for each metadata:
    //   if file not exist AND todoistTasks is empty -> delete metadata
    //   if file not exist BUT has todoistTasks -> search new path by taskId
    // 
    // ==========================================================================================

    /**
     * 检查并修复文件元数据中的错误
     * @returns Promise<void>
     * 
     * 【使用场景】
     * - 用户可能删除了 Vault 中的文件
     * - 用户可能重命名了文件
     * 此方法用于清理无效的元数据并更新重命名的文件
     */
    async checkFileMetadata(){
        const metadatas =  await this.getFileMetadatas()
        for (const key in metadatas) {
            let filepath = key
            const value = metadatas[key];
            let file = this.app.vault.getAbstractFileByPath(key)
            // 情况1: 文件不存在且元数据为空 -> 直接删除
            if(!file && (value.todoistTasks?.length === 0 || !value.todoistTasks)){
                console.log(`${key} is not existed and metadata is empty.`)
                await this.deleteFilepathFromMetadata(key)
                continue
            }
            // 情况2: 元数据为空 -> 跳过（可能是待处理的文件）
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

    // ==========================================================================================
    // getDefaultProjectNameForFilepath - 获取文件的默认项目名称
    // ==========================================================================================
    // 
    // 【功能】
    // 获取指定文件对应的默认项目名称
    // 如果文件没有设置默认项目，则使用插件全局默认项目
    // 
    // ==========================================================================================

    /**
     * 获取指定文件的默认项目名称
     * @param filepath - 文件路径
     * @returns 项目名称字符串
     */
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

    // ==========================================================================================
    // getDefaultProjectIdForFilepath - 获取文件的默认项目 ID
    // ==========================================================================================
    // 
    // 【功能】
    // 获取指定文件对应的默认项目 ID
    // 如果文件没有设置默认项目，则使用插件全局默认项目 ID
    // 
    // ==========================================================================================

    /**
     * 获取指定文件的默认项目 ID
     * @param filepath - 文件路径
     * @returns 项目 ID 字符串
     */
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

    // ==========================================================================================
    // setDefaultProjectIdForFilepath - 设置文件的默认项目 ID
    // ==========================================================================================
    // 
    // 【功能】
    // 为指定文件设置默认项目 ID
    // 该设置影响在此文件中创建的新任务的默认所属项目
    // 
    // ==========================================================================================

    /**
     * 设置指定文件的默认项目 ID
     * @param filepath - 文件路径
     * @param defaultProjectId - 项目 ID
     */
    setDefaultProjectIdForFilepath(filepath:string,defaultProjectId:string){
        const metadatas = this.plugin.settings.fileMetadata
        if (!metadatas[filepath]) {
            metadatas[filepath] = {}
        }
        metadatas[filepath].defaultProjectId = defaultProjectId
    
        // 将更新后的metadatas对象保存回设置对象中
        this.plugin.settings.fileMetadata = metadatas

    }

      
    // ==========================================================================================
    // DEPRECATED methods - 已废弃的方法
    // ==========================================================================================
    // 
    // 【说明】
    // 以下方法已不再使用，因为现在直接使用 Todoist API 的 syncData
    // 保留这些空方法是为了保持 API 兼容性，避免其他调用方报错
    // 
    // ==========================================================================================

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

    // ==========================================================================================
    // getProjectIdByNameFromCache - 根据项目名称获取项目 ID (已废弃)
    // ==========================================================================================
    // DEPRECATED: Using todoistSyncAPI.getProjectByName instead

    /**
     * 根据项目名称获取项目 ID（已废弃）
     * @deprecated 请使用 todoistSyncAPI.getProjectByName
     * @param projectName - 项目名称
     * @returns 项目 ID，如果不存在则返回 null
     */
    getProjectIdByNameFromCache(projectName: string): any {
        return this.plugin.todoistSyncAPI.getSyncData()?.projects?.find((p: any) => p.name === projectName)?.id || null;
    }

    // ==========================================================================================
    // getProjectNameByIdFromCache - 根据项目 ID 获取项目名称 (已废弃)
    // ==========================================================================================
    // DEPRECATED: Using todoistSyncAPI.getProjectById instead

    /**
     * 根据项目 ID 获取项目名称（已废弃）
     * @deprecated 请使用 todoistSyncAPI.getProjectById
     * @param projectId - 项目 ID
     * @returns 项目名称，如果不存在则返回 null
     */
    getProjectNameByIdFromCache(projectId: string): any {
        return this.plugin.todoistSyncAPI.getSyncData()?.projects?.find((p: any) => p.id === projectId)?.name || null;
    }

    // DEPRECATED: Using syncData from Todoist API instead
    async saveProjectsToCache(): Promise<boolean> { return true; }

    // ==========================================================================================
    // updateRenamedFilePath - 更新重命名文件的路径映射
    // ==========================================================================================
    // 
    // 【功能】
    // 当用户在 Obsidian 中重命名文件时，更新 taskFileMapping 和 fileMetadata 中的路径
    // 
    // 【参数】
    // - oldpath: 旧的文件路径
    // - newpath: 新的文件路径
    // 
    // 【流程】
    // 1. 遍历 taskFileMapping，将所有指向旧路径的任务更新为新路径
    // 2. 在 fileMetadata 中，将旧路径的元数据迁移到新路径
    // 3. 记录操作日志
    // 
    // ==========================================================================================

    /**
     * 更新重命名文件的路径映射
     * @deprecated 请使用 taskFileMapping 的自动更新
     * @param oldpath - 旧的文件路径
     * @param newpath - 新的文件路径
     */
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

    // ==========================================================================================
    // rebuildCache - 重建缓存（核心方法）
    // ==========================================================================================
    // 
    // 【功能】
    // 完整扫描 Vault 并与 Todoist 同步数据，是数据一致性的最终保障
    // 
    // 【执行流程】
    // Step 1: 清空 taskFileMapping（保留 fileMetadata，因为文件可能还在）
    // Step 2: 确保 syncData 已加载（从 Todoist API 获取最新数据）
    // Step 3: 扫描 Vault 中所有 .md 文件，查找带有 #todoist 标签的任务
    //         - 提取 todoist_id: %%[todoist_id:: xxx]%%
    //         - 提取任务内容（去除 checkbox、metadata、link 等）
    //         - 检查完成状态 ([x] = completed, [ ] = not completed)
    // Step 3.5: 检测并转换 legacy ID（旧版数字 ID -> 新版字符串 ID）
    //         - 遍历 Vault 中找到的任务 ID
    //         - 检查 ID 是否在 syncData 中
    //         - 不存在的 ID 可能是 legacy ID，通过内容匹配查找新 ID
    // Step 4: 遍历每个任务，与 Todoist 对比
    //         - 检查任务是否在 Todoist 存在
    //         - 对比内容是否一致
    //         - 对比完成状态是否一致
    //         - 检测到的冲突收集到数组中
    // Step 5: 弹出冲突解决对话框，让用户选择解决方式
    // Step 6: 保存设置（taskFileMapping 更新）
    // 
    // 【输出】
    // - { success: boolean, tasksProcessed: number }
    // 
    // 【使用场景】
    // - 插件首次加载时
    // - 用户点击"重建缓存"按钮
    // - 数据出现不一致时手动修复
    // 
    // ==========================================================================================

    /**
     * 重建缓存 - 扫描 Vault 并与 Todoist 同步
     * @param noticeCallback - 可选的进度回调函数
     * @returns Promise<{ success: boolean; tasksProcessed: number }>
     */
    async rebuildCache(noticeCallback?: (message: string) => void): Promise<{ success: boolean; tasksProcessed: number }> {
        try {
            if (noticeCallback) {
                noticeCallback('Starting cache rebuild...');
            } else {
                console.log('Starting cache rebuild...');
            }
            this.plugin.logOperation?.log('CACHE_REBUILT', 'Starting cache rebuild...');

            // ==========================================================================================
            // Step 1: 清空 taskFileMapping
            // ==========================================================================================
            // 
            // 【说明】
            // taskFileMapping 是从任务 ID 到文件位置的映射
            // 重建缓存时需要重新扫描，所以先清空
            // fileMetadata 保留，因为文件本身可能还在
            // 
            // ==========================================================================================
            
            // Step 1: Clear taskFileMapping (keep fileMetadata for other uses)
            this.plugin.settings.taskFileMapping = {};

            // ==========================================================================================
            // Step 2: 确保 syncData 已加载
            // ==========================================================================================
            // 
            // 【说明】
            // syncData 是从 Todoist API 获取的同步数据
            // 包含所有任务、项目、标签等信息
            // 如果未加载，则调用 initializeSync() 获取
            // 
            // ==========================================================================================

            // Step 2: Ensure syncData is loaded
            if (noticeCallback) {
                noticeCallback('Ensuring sync data is loaded...');
            } else {
                console.log('Ensuring sync data is loaded...');
            }
            
            const syncData = this.plugin.todoistSyncAPI.getSyncData();
            if (!syncData) {
                await this.plugin.todoistSyncAPI.initializeSync();
            }

            // ==========================================================================================
            // Step 3: 扫描 Vault 中所有 .md 文件
            // ==========================================================================================
            // 
            // 【说明】
            // 遍历 Vault 中的所有 markdown 文件
            // 查找带有 #todoist 标签的任务行
            // 提取任务信息：
            //   - todoist_id: %%[todoist_id:: xxx]%%
            //   - 任务内容（使用 taskParser 去除各种标记）
            //   - 完成状态 ([x] = 已完成, [ ] = 未完成)
            // 
            // 【数据结构 fileTaskMap】
            // Map<filePath, Array<{taskId, lineNumber, content, isCompleted}>>
            // 
            // 【注意】
            // 这里只提取有 %%[todoist_id:: xxx]%% 的任务
            // 没有 ID 的任务会在后续被当作新任务处理
            // 
            // ==========================================================================================

            // Step 3: Scan Vault for all .md files
            if (noticeCallback) {
                noticeCallback('Scanning vault for tasks...');
            } else {
                console.log('Scanning vault for tasks...');
            }
            
            const files = this.app.vault.getFiles()
                .filter(f => f.extension === 'md');
            
            // fileTaskMap: Map<filePath, tasks[]>
            const fileTaskMap: Map<string, { taskId: string; lineNumber: number; content: string; isCompleted: boolean }[]> = new Map();
            
            for (const file of files) {
                try {
                    // 读取文件内容
                    const content = await this.app.vault.cachedRead(file);
                    const lines = content.split('\n');
                    
                    // 遍历每一行
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        // 检查是否包含 #todoist 标签
                        if (line.includes('#todoist')) {
                            // 提取 todoist_id: %%[todoist_id:: xxx]%%
                            const match = line.match(/%%\[todoist_id::\s*(\w+)\]%%/);
                            if (match && match[1]) {
                                const taskId = match[1];
                                // 使用 taskParser 提取任务内容（去除 checkbox、metadata、link 等）
                                const taskContent = this.plugin.taskParser.getTaskContentFromLineText(line);
                                // 检查完成状态 - [x] = 已完成, [ ] = 未完成
                                const isCompleted = /\[x\]/i.test(line);
                                
                                // 添加到 fileTaskMap
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

            // ==========================================================================================
            // Step 3.5: 检测并转换 legacy ID
            // ==========================================================================================
            // 
            // 【背景】
            // Todoist API 在 2024 年将任务 ID 从数字格式（如 123456）改为字符串格式（如 "abc123"）
            // 旧版插件存储的是数字 ID，新版 API 返回的是字符串 ID
            // 需要通过任务内容匹配来找到对应的新 ID
            // 
            // 【逻辑】
            // 1. 获取 syncData 中所有活动的任务 ID
            // 2. 遍历 Vault 中的任务 ID
            // 3. 如果 ID 不在 syncData 中，可能是 legacy ID
            // 4. 将这些任务收集起来，调用 convertLegacyIds 进行内容匹配
            // 
            // 【convertLegacyIds 逻辑】
            // 1. 遍历所有 syncData 中的任务
            // 2. 标准化任务内容（小写、去除多余空格）
            // 3. 查找内容完全匹配的任务
            // 4. 如果找到唯一匹配，则记录映射关系
            // 5. 如果找到多个匹配，抛出错误（需要手动处理）
            // 6. 如果没有找到，记录日志并跳过
            // 
            // ==========================================================================================

            // Step 3.5: Detect and convert legacy IDs
            if (noticeCallback) {
                noticeCallback('Checking for legacy IDs...');
            } else {
                console.log('Checking for legacy IDs...');
            }

            // 获取 syncData 中所有活动的任务 ID（用于判断是否是 legacy ID）
            const activeTaskIds = new Set(syncData?.items?.map(t => t.id) || []);

            // 找出需要转换的潜在 legacy ID（不在 syncData 中的 ID）
            const tasksNeedConversion: { taskId: string; content: string; filePath: string; lineNumber: number }[] = [];

            for (const [filePath, fileTasks] of fileTaskMap.entries()) {
                for (const taskInfo of fileTasks) {
                    if (!activeTaskIds.has(taskInfo.taskId)) {
                        // ID 不在 syncData 中 - 可能是 legacy ID
                        tasksNeedConversion.push({
                            taskId: taskInfo.taskId,
                            content: taskInfo.content,
                            filePath,
                            lineNumber: taskInfo.lineNumber
                        });
                    }
                }
            }

            // 如果有需要转换的 ID，调用 convertLegacyIds 进行转换
            let idMapping: { [oldId: string]: string } = {};
            let convertedCount = 0;
            if (tasksNeedConversion.length > 0) {
                if (noticeCallback) {
                    noticeCallback(`Converting ${tasksNeedConversion.length} legacy IDs...`);
                }
                // 调用 todoistSyncAPI 的 convertLegacyIds 方法
                // 该方法通过任务内容匹配来找到对应的新 ID
                idMapping = await this.plugin.todoistSyncAPI.convertLegacyIds(tasksNeedConversion);
                convertedCount = Object.keys(idMapping).length;
                console.log(`[rebuildCache] Converted ${convertedCount} legacy IDs`);
            }

            // ==========================================================================================
            // Step 4: 处理任务并检测冲突
            // ==========================================================================================
            // 
            // 【说明】
            // 遍历 Vault 中扫描到的所有任务，与 Todoist 进行对比
            // 
            // 【检测内容】
            // 1. 任务是否存在（使用转换后的 ID 查询 Todoist）
            // 2. 任务内容是否一致
            // 3. 完成状态是否一致
            // 
            // 【冲突类型】
            // - contentConflict: Obsidian 任务内容与 Todoist 不一致
            // - statusConflict: 完成状态不一致（一边完成/未完成，另一边相反）
            // 
            // 【无效任务处理】
            // - 任务在 Todoist 中不存在（可能被删除）
            // - 记录到 invalidTaskIds，后续会从缓存中移除
            // 
            // ==========================================================================================

            // Step 4: Process tasks and detect conflicts
            if (noticeCallback) {
                noticeCallback('Processing tasks and detecting conflicts...');
            } else {
                console.log('Processing tasks and detecting conflicts...');
            }
            
            // 收集冲突任务
            const conflicts: TaskConflict[] = [];
            let processedCount = 0;
            const totalTasks = Array.from(fileTaskMap.values())
                .reduce((sum, tasks) => sum + tasks.length, 0);
            
            // 记录无效的任务 ID（不在 Todoist 中）
            const invalidTaskIds: string[] = [];
            
            // 遍历每个文件的每个任务
            for (const [filePath, fileTasks] of fileTaskMap.entries()) {
                for (const taskInfo of fileTasks) {
                    try {
                        // 使用转换后的 ID（如果有的话），否则使用原始 ID
                        const taskId = idMapping[taskInfo.taskId] || taskInfo.taskId;
                        
                        // 从 syncData 中获取任务（使用可能转换后的 ID）
                        const task = await this.plugin.todoistSyncAPI.GetTaskById(taskId);
                        
                        // 情况1: 任务在 Todoist 中不存在（即使转换后也找不到）
                        if (!task) {
                            console.log(`Task ${taskId} (original: ${taskInfo.taskId}) not found in Todoist, will be removed...`);
                            // 记录无效 ID
                            invalidTaskIds.push(taskInfo.taskId);
                            // 记录日志
                            this.plugin.logOperation?.log('CACHE_TASK_DELETED', `Task ${taskInfo.taskId} not found in Todoist during rebuild`, filePath, taskInfo.taskId);
                            // 跳过此任务
                            continue;
                        }
                        
                        // 情况2: 如果 ID 被转换了，更新 Vault 文件和 taskFileMapping
                        if (idMapping[taskInfo.taskId]) {
                            // 调用 fileOperation 更新 Vault 文件中的 ID
                            await this.plugin.fileOperation.updateTaskIdInVault(
                                taskInfo.filePath,
                                taskInfo.lineNumber,
                                taskInfo.taskId,
                                taskId
                            );
                            
                            // 使用新 ID 更新 taskFileMapping
                            this.plugin.settings.taskFileMapping[taskId] = {
                                filePath: taskInfo.filePath,
                                lineNumber: taskInfo.lineNumber
                            };
                            // 删除旧的映射
                            delete this.plugin.settings.taskFileMapping[taskInfo.taskId];
                            
                            console.log(`[rebuildCache] Updated mapping: ${taskInfo.taskId} -> ${taskId}`);
                        }
                        
                        // 对比任务内容
                        const todoistContent = task.content || '';
                        const obsidianContent = taskInfo.content;
                        
                        // 使用转换后的 ID 用于映射
                        const mappingTaskId = idMapping[taskInfo.taskId] || taskInfo.taskId;
                        
                        // 检查完成状态
                        const todoistIsCompleted = task.isCompleted || false;
                        const obsidianIsCompleted = taskInfo.isCompleted;
                        
                        // 检测内容冲突
                        const contentConflict = obsidianContent.trim() !== todoistContent.trim();
                        // 检测状态冲突
                        const statusConflict = obsidianIsCompleted !== todoistIsCompleted;
                        
                        // 如果有冲突，添加到冲突列表
                        if (contentConflict || statusConflict) {
                            conflicts.push({
                                taskId: mappingTaskId,
                                filePath: filePath,
                                obsidianContent: obsidianContent,
                                todoistContent: todoistContent,
                                lineNumber: taskInfo.lineNumber
                            });
                        }
                        
                        // 保存到 taskFileMapping（使用转换后的 ID）
                        this.plugin.settings.taskFileMapping[mappingTaskId] = {
                            filePath: filePath,
                            lineNumber: taskInfo.lineNumber
                        };
                        
                        processedCount++;
                        
                        // 每处理 10 个任务更新一次 UI
                        if (noticeCallback && processedCount % 10 === 0) {
                            noticeCallback(`Processing ${processedCount}/${totalTasks}...`);
                        }
                    } catch (error) {
                        console.error(`Error processing task ${taskInfo.taskId}:`, error);
                        invalidTaskIds.push(taskInfo.taskId);
                    }
                }
            }

            // ==========================================================================================
            // Step 5: 记录冲突（暂不处理）
            // ==========================================================================================
            // 
            // 【说明】
            // 冲突检测逻辑较复杂，需要考虑太多情况，暂不自动处理
            // 只记录冲突信息，留待后续完善
            // 
            // ==========================================================================================

            // Step 5: Record conflicts (not processed yet)
            if (conflicts.length > 0) {
                console.log(`[rebuildCache] Found ${conflicts.length} conflicts (not processed yet):`);
                for (const conflict of conflicts) {
                    console.log(`  - Task ${conflict.taskId} in ${conflict.filePath}:${conflict.lineNumber}`);
                    console.log(`    Obsidian: "${conflict.obsidianContent}"`);
                    console.log(`    Todoist: "${conflict.todoistContent}"`);
                }
                this.plugin.logOperation?.log('CACHE_REBUILT', `Found ${conflicts.length} conflicts during rebuild`);
            }
            
            // ==========================================================================================
            // Step 6: 保存设置
            // ==========================================================================================
            // 
            // 【说明】
            // 所有处理完成后，保存更新后的设置
            // 主要保存 taskFileMapping 的更新
            // 
            // ==========================================================================================
            
            // Step 6: Save settings
            await this.plugin.saveSettings();
            
            // 构建结果消息
            const invalidMsg = invalidTaskIds.length > 0 ? ` (${invalidTaskIds.length} tasks not found in Todoist removed)` : '';
            const conflictMsg = conflicts.length > 0 ? ` (${conflicts.length} conflicts found, not processed)` : '';
            const convertedMsg = convertedCount > 0 ? ` (${convertedCount} legacy IDs converted)` : '';
            const message = `Cache rebuilt! ${processedCount} tasks processed.${convertedMsg}${invalidMsg}${conflictMsg}`;
            this.plugin.logOperation?.log('CACHE_REBUILT', `Cache rebuilt successfully! ${processedCount} tasks processed.${convertedMsg}${invalidMsg}${conflictMsg}`);
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

    // ==========================================================================================
    // extractTaskContent - 提取任务内容（辅助方法）
    // ==========================================================================================
    // 
    // 【功能】
    // 从任务行中提取纯文本内容，去除各种标记
    // 
    // 【处理步骤】
    // 1. 去掉 checkbox 标记 [- ] 或 [x]
    // 2. 去掉 #todoist 标签
    // 3. 去掉 todoist_id 元数据 %%[todoist_id:: xxx]%%
    // 4. 去掉 link [link](url)
    // 5. 去掉日期 🗓️📅📆🗓 2024-01-01
    // 6. 去掉优先级 !!1 !!2 !!3 !!4
    // 
    // 【注意】
    // 此方法是 private，只在类内部使用
    // 
    // ==========================================================================================

    /**
     * 从任务行中提取纯文本内容
     * @param line - 任务行文本
     * @returns 提取后的纯文本内容
     */
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

    // ==========================================================================================
    // resolveConflicts - 解决冲突（辅助方法）
    // ==========================================================================================
    // 
    // 【功能】
    // 根据用户选择的解决方式，执行实际的更新操作
    // 
    // 【解决方式】
    // - obsidian: 用 Obsidian 内容更新 Todoist（调用 UpdateTask API）
    // - todoist: 用 Todoist 内容更新 Obsidian 文件（修改文件内容）
    // - skip: 跳过，不做任何操作
    // 
    // 【参数】
    // - resolutions: Map<taskId, ConflictResolution> 用户选择的解决方式
    // - conflicts: TaskConflict[] 冲突列表
    // 
    // ==========================================================================================

    /**
     * 解决冲突
     * @param resolutions - 用户选择的解决方式映射
     * @param conflicts - 冲突列表
     */
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
