/**
 * ==========================================================================================
 * CacheOperation 模块 - 任务缓存与重建核心逻辑
 * ==========================================================================================
 * 
 * 【模块职责】
 * 本模块负责管理 Obsidian 与 Todoist 之间的任务缓存数据，包括：
 * 1. fileMetadata - 每个文件的元数据（仅保存 defaultProjectId）
 * 2. taskFileMapping - 任务ID到文件路径的映射（taskId -> {filePath, status, syncEnabled}）
 * 3. rebuildCache - 重建缓存的核心方法，用于扫描 Vault 并与 Todoist 同步
 * 
 * 【数据结构】
 * - fileMetadata: { [filepath]: { defaultProjectId?: string } }
 *   存储每个 markdown 文件的默认项目 ID（任务列表从 taskFileMapping 推导）
 * 
 * - taskFileMapping: { [taskId]: { 
 *     filePath: string, 
 *     status?: 'active' | 'nonActive' | 'conflicted' | 'issue',
 *     syncEnabled?: boolean 
 *   } }
 *   存储每个任务ID对应的文件位置和同步状态，用于双向同步定位
 * 
 * 【status 字段说明】
 * - 'active': 正常任务，syncEnabled=true
 * - 'nonActive': Vault 已完成但 Todoist 不存在（任务可能被删除），syncEnabled=false
 * - 'conflicted': 内容或状态冲突，syncEnabled=false
 * - 'issue': Vault 未完成但 Todoist 不存在（异常状态），syncEnabled=false
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

import { App, Notice, TFile} from 'obsidian';
import UltimateTodoistSyncForObsidian from "../../main";
import { TaskConflict } from '../ui/modals';
import { deriveTaskStatusFromIssueEntries, normalizeTaskIssueTypeKey } from './taskIssueUtils';

export interface RebuildCacheResult {
    success: boolean;
    tasksProcessed: number;
    conflictsCount: number;
    nonActiveCount: number;
    issueCount: number;
    convertedCount: number;
    tasksWithoutIdCount: number;
}

type TaskIssueState = 'open' | 'resolved' | 'ignored';
type TaskIssueSeverity = 'low' | 'medium' | 'high';
type TaskIssueSource = 'database_checker' | 'runtime';

type TaskIssueRecord = Record<string, {
    state: TaskIssueState;
    severity: TaskIssueSeverity;
    source: TaskIssueSource;
    detectedAt: number;
    lastSeenAt: number;
    details?: string;
    expected?: string;
    actual?: string;
    manualAction?: string;
}>;

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
 *     defaultProjectId: "project123"         // 可选，默认项目 ID
 *   }
 * }
 * 
 * 【注意】
 * - 任务列表从 taskFileMapping 推导，不存储在 fileMetadata 中
 * - 使用 getTasksInFile() 和 getTaskCountInFile() 获取文件的任务信息
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
    async getFileMetadata(filepath: string): Promise<{ defaultProjectId?: string } | null> {
        return this.plugin.settings.fileMetadata?.[filepath] ?? null;
    }

    /**
     * 获取所有文件的元数据
     * @returns 全部 fileMetadata 对象
     */
    async getFileMetadatas(): Promise<Record<string, { defaultProjectId?: string }> | null> {
        return this.plugin.settings.fileMetadata ?? null;
    }

    /**
     * 为指定文件创建新的空元数据
     * @param filepath - 文件路径
     * 
     * 【使用场景】
     * - 当首次在文件中添加 Todoist 任务时调用
     * - 初始化 defaultProjectId
     */
    async newEmptyFileMetadata(filepath: string): Promise<void> {
        const metadatas = { ...this.plugin.settings.fileMetadata };
        if (metadatas[filepath]) {
            return;
        }
        metadatas[filepath] = {};
        await this.plugin.safeSettings?.update({ fileMetadata: metadatas });
    }

    /**
     * 更新指定文件的元数据
     * @param filepath - 文件路径
     * @param newMetadata - 新的元数据对象（只需包含 defaultProjectId）
     * 
     * 【使用场景】
     * - 当需要更新文件的默认项目时调用
     */
    async updateFileMetadata(filepath: string, newMetadata: { defaultProjectId?: string }): Promise<void> {
        const metadatas = { ...this.plugin.settings.fileMetadata };
    
        if (!metadatas[filepath]) {
            metadatas[filepath] = {};
        }
    
        if (newMetadata.defaultProjectId !== undefined) {
            metadatas[filepath].defaultProjectId = newMetadata.defaultProjectId;
        }
    
        await this.plugin.safeSettings?.update({ fileMetadata: metadatas });
        this.plugin.logOperation?.log('CACHE_FILE_METADATA_UPDATED', `Updated file metadata for: ${filepath}`, filepath);
    }

    // ==========================================================================================
    // Helper Methods - 从 taskFileMapping 推导文件任务信息
    // ==========================================================================================

    /**
     * 从 taskFileMapping 推导指定文件的所有任务 ID
     * @param filepath - 文件路径
     * @returns 任务 ID 数组
     */
    getTasksInFile(filepath: string): string[] {
        const mapping = this.plugin.settings.taskFileMapping;
        return Object.entries(mapping)
            .filter(([_, value]) => value.filePath === filepath)
            .map(([taskId]) => taskId);
    }

    /**
     * 从 taskFileMapping 推导指定文件的任务数量
     * @param filepath - 文件路径
     * @returns 任务数量
     */
    getTaskCountInFile(filepath: string): number {
        return this.getTasksInFile(filepath).length;
    }

    // ==========================================================================================

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
        const metadatas = { ...this.plugin.settings.fileMetadata };
        delete metadatas[filepath];
        await this.plugin.safeSettings?.update({ fileMetadata: metadatas }, true)
        this.plugin.logOperation?.log('CACHE_FILE_METADATA_DELETED', `Deleted file metadata for: ${filepath}`, filepath);
        this.plugin.debugLog(`${filepath} is deleted from file metadatas.`)
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
    //     this.plugin.debugLog(`new metadata ${newMetadata}`)
    // }

    // ==========================================================================================
    // TaskFileMapping 方法组
    // ==========================================================================================
    // 
    // 【taskFileMapping 数据结构】
    // {
    //   "taskId123": { filePath: "folder/file.md", status: 'active', syncEnabled: true },
    //   "taskId456": { filePath: "folder/file2.md", status: 'conflicted', syncEnabled: false }
    // }
    //
    // 【status 字段说明】
    // - 'active': 正常任务，syncEnabled=true
    // - 'nonActive': Vault 已完成但 Todoist 不存在（任务被删除），syncEnabled=false
    // - 'conflicted': 内容或状态冲突，syncEnabled=false
    // - 'issue': Vault 未完成但 Todoist 不存在（异常），syncEnabled=false
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
     * @returns 文件路径、状态和同步开关，如果不存在则返回 null
     */
    getTaskFileMapping(taskId: string): { filePath: string; status?: string; syncEnabled?: boolean; updated_at?: string; note_count?: number; issues?: Record<string, unknown> } | null {
        return this.plugin.settings.taskFileMapping[taskId] ?? null;
    }

    // syncEnabled undefined → true (backward compat with old mappings)
    isTaskSyncEnabled(taskId: string): boolean {
        const mapping = this.plugin.settings.taskFileMapping[taskId];
        if (!mapping) return false;
        return mapping.syncEnabled !== false;
    }

    /**
     * 设置任务 ID 到文件位置的映射
     * @param taskId - Todoist 任务 ID
     * @param filePath - Obsidian 文件路径
     * @param status - 任务状态（'active' | 'nonActive' | 'conflicted' | 'issue'），默认 'active'
     * @param syncEnabled - 是否启用同步，默认 true
     */
    async setTaskFileMapping(taskId: string, filePath: string, status: 'active' | 'nonActive' | 'conflicted' | 'issue' = 'active', syncEnabled: boolean = true): Promise<void> {
        const mapping = { ...this.plugin.settings.taskFileMapping };
        const existing = mapping[taskId];
        const nextStatus = deriveTaskStatusFromIssueEntries(existing?.issues as Record<string, { state?: string }> | undefined, status);
        const nextSyncEnabled = nextStatus === 'active' ? syncEnabled : false;
        mapping[taskId] = { ...existing, filePath, status: nextStatus, syncEnabled: nextSyncEnabled };
        await this.plugin.safeSettings?.update({ taskFileMapping: mapping });
    }

    async updateTaskMappingSyncMeta(taskId: string, meta: { updated_at?: string; note_count?: number }): Promise<void> {
        const existing = this.plugin.settings.taskFileMapping[taskId];
        if (!existing) return;
        const mapping = { ...this.plugin.settings.taskFileMapping };
        mapping[taskId] = { ...existing };
        if (meta.updated_at !== undefined) mapping[taskId].updated_at = meta.updated_at;
        if (meta.note_count !== undefined) mapping[taskId].note_count = meta.note_count;
        await this.plugin.safeSettings?.update({ taskFileMapping: mapping });
    }

    async upsertTaskIssue(
        taskId: string,
        issueType: string,
        issue: {
            state?: TaskIssueState;
            severity?: TaskIssueSeverity;
            source?: TaskIssueSource;
            details?: string;
            expected?: string;
            actual?: string;
            manualAction?: string;
        },
        shouldSave: boolean = true
    ): Promise<void> {
        const existing = this.plugin.settings.taskFileMapping[taskId];
        if (!existing) return;

        const mapping = { ...this.plugin.settings.taskFileMapping };
        const current = mapping[taskId];
        if (!current) return;

        const now = Date.now();
        const issueRecord: TaskIssueRecord = {};
        if (current.issues && typeof current.issues === 'object' && !Array.isArray(current.issues)) {
            for (const [existingIssueType, existingIssue] of Object.entries(current.issues as TaskIssueRecord)) {
                issueRecord[normalizeTaskIssueTypeKey(existingIssueType)] = existingIssue;
            }
        }

        const normalizedIssueType = normalizeTaskIssueTypeKey(issueType);
        const previous = issueRecord[normalizedIssueType];
        issueRecord[normalizedIssueType] = {
            state: issue.state ?? 'open',
            severity: issue.severity ?? 'medium',
            source: issue.source ?? 'runtime',
            detectedAt: typeof previous?.detectedAt === 'number' ? previous.detectedAt : now,
            lastSeenAt: now,
            details: issue.details,
            expected: issue.expected,
            actual: issue.actual,
            manualAction: issue.manualAction,
        };

        const fallbackStatus = (current.status || 'active') as 'active' | 'nonActive' | 'conflicted' | 'issue';
        const nextStatus = deriveTaskStatusFromIssueEntries(issueRecord, fallbackStatus);
        const nextSyncEnabled = nextStatus === 'active' ? (current.syncEnabled ?? true) : false;

        mapping[taskId] = {
            ...current,
            issues: issueRecord,
            status: nextStatus,
            syncEnabled: nextSyncEnabled,
        };

        await this.plugin.safeSettings?.update({ taskFileMapping: mapping }, shouldSave);
    }

    /**
     * 删除指定任务 ID 的文件映射
     * @param taskId - Todoist 任务 ID
     */
    async deleteTaskFileMapping(taskId: string): Promise<void> {
        const mapping = { ...this.plugin.settings.taskFileMapping };
        delete mapping[taskId];
        await this.plugin.safeSettings?.update({ taskFileMapping: mapping });
    }

    /**
     * 获取所有任务 ID 到文件位置的映射
     * @returns 完整的 taskFileMapping 对象
     */
    getAllTaskFileMappings(): { [taskId: string]: { filePath: string } } {
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
            const tasks = this.getTasksInFile(key);
            let file = this.app.vault.getAbstractFileByPath(key)
            // 情况1: 文件不存在且没有关联任务 -> 直接删除
            if(!file && tasks.length === 0){
                this.plugin.debugLog(`${key} is not existed and has no tasks.`)
                await this.deleteFilepathFromMetadata(key)
                continue
            }
            // 情况2: 没有关联任务 -> 跳过
            if(tasks.length === 0){
                continue
            }
            //check if file exist
            
            if(!file){
                //search new filepath
                this.plugin.debugLog(`file ${filepath} is not exist`) 
                const todoistId1 = tasks[0]
                if (!todoistId1) {
                    continue;
                }
                if (!this.plugin.fileOperation) {
                    continue;
                }
                this.plugin.debugLog(todoistId1)
                const searchResult = await this.plugin.fileOperation.searchFilepathsByTaskidInVault(todoistId1)
                this.plugin.debugLog(`new file path is`)
                this.plugin.debugLog(searchResult)

				//update metadata
				if (typeof searchResult === 'string' && searchResult.length > 0) {
					await this.updateRenamedFilePath(filepath, searchResult)
				}
				const saved = await this.plugin.saveSettings();
				if (!saved) {
					console.warn('[checkFileMetadata] saveSettings skipped or failed');
				}

            }


            //const fileContent = await this.app.vault.read(file)
            //check if file include all tasks


            /*
            tasks.forEach(async(taskId) => {
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
            const project = this.plugin.todoistSyncAPI?.getSyncData()?.projects?.find((p: any) => p.id === defaultProjectId);
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
	async setDefaultProjectIdForFilepath(filepath:string, defaultProjectId:string): Promise<void> {
		const metadatas = { ...this.plugin.settings.fileMetadata }
		if (!metadatas[filepath]) {
			metadatas[filepath] = {}
		}
		metadatas[filepath].defaultProjectId = defaultProjectId

		await this.plugin.safeSettings?.update({ fileMetadata: metadatas }, true)

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
    modifyTaskToCacheByID(_taskId: string, _params: { content?: string, due?: any }): void {}
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
        return this.plugin.todoistSyncAPI?.getSyncData()?.projects?.find((p: any) => p.name === projectName)?.id || null;
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
        return this.plugin.todoistSyncAPI?.getSyncData()?.projects?.find((p: any) => p.id === projectId)?.name || null;
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
        const taskFileMapping = { ...this.plugin.settings.taskFileMapping };
        const fileMetadata = { ...this.plugin.settings.fileMetadata };
        for (const [taskId, mapping] of Object.entries(taskFileMapping)) {
            if (mapping.filePath === oldpath) {
                taskFileMapping[taskId] = { ...mapping, filePath: newpath };
            }
        }
        if (fileMetadata[oldpath]) {
            fileMetadata[newpath] = fileMetadata[oldpath];
            delete fileMetadata[oldpath];
        }
        await this.plugin.safeSettings?.update({ 
            taskFileMapping, 
            fileMetadata 
        }, true);
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
     * @returns Promise<RebuildCacheResult>
     */
    async rebuildCache(noticeCallback?: (message: string) => void): Promise<RebuildCacheResult> {
        const backupMapping = { ...this.plugin.settings.taskFileMapping };
        try {
            if (noticeCallback) {
                noticeCallback('Starting cache rebuild...');
            } else {
                this.plugin.debugLog('Starting cache rebuild...');
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
            
            // Step 1: Backup old mapping, then clear (restore on failure)
            await this.plugin.safeSettings?.update({ taskFileMapping: {} }, false);

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
                this.plugin.debugLog('Ensuring sync data is loaded...');
            }
            
            const todoistSyncAPI = this.plugin.todoistSyncAPI;
            if (!todoistSyncAPI) {
                throw new Error('Todoist Sync API is not initialized');
            }

            let syncData = todoistSyncAPI.getSyncData();
            if (!syncData) {
                await todoistSyncAPI.initializeSync();
                syncData = todoistSyncAPI.getSyncData();
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
                this.plugin.debugLog('Scanning vault for tasks...');
            }
            
            // 使用 fileOperation 的统一扫描方法
            if (!this.plugin.fileOperation) {
                throw new Error('File operation module is not initialized');
            }
            const { tasksWithId, tasksWithoutId } = await this.plugin.fileOperation.scanVaultTasks();
            
            // 转换为 fileTaskMap 格式: Map<filePath, tasks[]>
            const fileTaskMap: Map<string, { taskId: string; lineNumber: number; content: string; isCompleted: boolean }[]> = new Map();
            
            for (const [taskId, task] of tasksWithId.entries()) {
                if (!fileTaskMap.has(task.filePath)) {
                    fileTaskMap.set(task.filePath, []);
                }
                fileTaskMap.get(task.filePath)!.push({
                    taskId,
                    lineNumber: task.lineNumber,
                    content: task.content,
                    isCompleted: task.isCompleted
                });
            }
            
            // 记录无 ID 的任务（新任务未同步）
            if (tasksWithoutId.length > 0) {
                this.plugin.debugLog(`[rebuildCache] Found ${tasksWithoutId.length} tasks without todoist_id (new tasks not synced)`);
                for (const task of tasksWithoutId) {
                    this.plugin.logOperation?.log(
                        'CACHE_TASK_NON_ID',
                        `Task without todoist_id found: ${task.content.substring(0, 50)}`,
                        task.filePath,
                        undefined
                    );
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
                this.plugin.debugLog('Checking for legacy IDs...');
            }

            // 获取 syncData 中所有活动的任务 ID（用于判断是否是 legacy ID）
            const activeTaskIds = new Set(syncData?.items?.map((t: { id: string }) => t.id) || []);

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
                try {
                    idMapping = await todoistSyncAPI.convertLegacyIds(tasksNeedConversion);
                    convertedCount = Object.keys(idMapping).length;
                    this.plugin.debugLog(`[rebuildCache] Converted ${convertedCount} legacy IDs`);
                } catch (error) {
                    console.warn(`[rebuildCache] Legacy ID conversion failed: ${(error as Error).message}. These tasks will remain with their old IDs and may trigger conversion again on next rebuild.`);
                    this.plugin.debugLog('[rebuildCache] Will continue without converting legacy IDs');
                    // 继续执行，不使用转换后的 ID
                    idMapping = {};
                }
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
                this.plugin.debugLog('Processing tasks and detecting conflicts...');
            }
            
            const syncItemsMap = new Map<string, any>();
            for (const item of (syncData?.items || [])) {
                if (item?.id) syncItemsMap.set(item.id, item);
            }
            
            const nextMapping: Record<string, { filePath: string; status?: 'active' | 'nonActive' | 'conflicted' | 'issue'; syncEnabled?: boolean; updated_at?: string; note_count?: number; issues?: TaskIssueRecord }> = {};
            const conflicts: TaskConflict[] = [];
            let processedCount = 0;
            let nonActiveCount = 0;
            let issueCount = 0;
            const now = Date.now();
            const totalTasks = Array.from(fileTaskMap.values())
                .reduce((sum, tasks) => sum + tasks.length, 0);
            const invalidTaskIds: string[] = [];
            
            for (const [filePath, fileTasks] of fileTaskMap.entries()) {
                for (const taskInfo of fileTasks) {
                    try {
                        const taskId = idMapping[taskInfo.taskId] || taskInfo.taskId;
                        const task = syncItemsMap.get(taskId);
                        
                        if (!task) {
                            const status = taskInfo.isCompleted ? 'nonActive' : 'issue';
                            const issueType = taskInfo.isCompleted ? 'task_nonactive' : 'task_deleted_in_todoist';
                            const issueSeverity: TaskIssueSeverity = taskInfo.isCompleted ? 'low' : 'high';
                            if (status === 'nonActive') nonActiveCount++;
                            else issueCount++;
                            nextMapping[taskInfo.taskId] = {
                                filePath,
                                status,
                                syncEnabled: false,
                                issues: {
                                    [issueType]: {
                                        state: 'open',
                                        severity: issueSeverity,
                                        source: 'runtime',
                                        detectedAt: now,
                                        lastSeenAt: now,
                                        details: taskInfo.isCompleted
                                            ? 'Task is completed in vault but missing in Todoist.'
                                            : 'Task no longer exists in Todoist.',
                                        manualAction: 'Resolve in Manage Problem Tasks',
                                    }
                                }
                            };
                            this.plugin.logOperation?.log(
                                taskInfo.isCompleted ? 'CACHE_TASK_NONACTIVE' : 'CACHE_TASK_ISSUE',
                                `Task ${taskInfo.taskId} marked as ${status}`,
                                filePath, taskInfo.taskId
                            );
                            continue;
                        }
                        
                        if (idMapping[taskInfo.taskId]) {
                            await this.plugin.fileOperation!.updateTaskIdInVault(
                                filePath,
                                taskInfo.taskId, taskId
                            );
                            this.plugin.debugLog(`[rebuildCache] Updated mapping: ${taskInfo.taskId} -> ${taskId}`);
                        }
                        
                        const mappingTaskId = idMapping[taskInfo.taskId] || taskInfo.taskId;
                        const todoistContent = task.content || '';
                        const obsidianContent = taskInfo.content;
                        const todoistIsCompleted = !!(task as any).checked;
                        const obsidianIsCompleted = taskInfo.isCompleted;
                        
                        const contentConflict = obsidianContent.trim() !== todoistContent.trim();
                        const statusConflict = obsidianIsCompleted !== todoistIsCompleted;
                        
                        if (contentConflict || statusConflict) {
                            const conflictIssues: TaskIssueRecord = {};
                            if (contentConflict) {
                                conflictIssues.content_mismatch = {
                                    state: 'open',
                                    severity: 'high',
                                    source: 'runtime',
                                    detectedAt: now,
                                    lastSeenAt: now,
                                    details: 'Task content differs between Obsidian and Todoist.',
                                };
                            }
                            if (statusConflict) {
                                conflictIssues.status_mismatch = {
                                    state: 'open',
                                    severity: 'high',
                                    source: 'runtime',
                                    detectedAt: now,
                                    lastSeenAt: now,
                                    details: 'Task completion status differs between Obsidian and Todoist.',
                                };
                            }
                            conflicts.push({
                                taskId: mappingTaskId, filePath,
                                obsidianContent, todoistContent,
                                lineNumber: taskInfo.lineNumber
                            });
                            nextMapping[mappingTaskId] = {
                                filePath,
                                status: 'conflicted',
                                syncEnabled: false,
                                issues: conflictIssues,
                            };
                            this.plugin.logOperation?.log('CACHE_TASK_CONFLICTED', `Task ${mappingTaskId} marked as conflicted`, filePath, mappingTaskId);
                        } else {
                            nextMapping[mappingTaskId] = {
                                filePath,
                                status: 'active', syncEnabled: true,
                                updated_at: task.updated_at ?? undefined
                            };
                        }
                        
                        processedCount++;
                        
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
                this.plugin.debugLog(`[rebuildCache] Found ${conflicts.length} conflicts (not processed yet):`);
                for (const conflict of conflicts) {
                    this.plugin.debugLog(`  - Task ${conflict.taskId} in ${conflict.filePath}:${conflict.lineNumber}`);
                    this.plugin.debugLog(`    Obsidian: "${conflict.obsidianContent}"`);
                    this.plugin.debugLog(`    Todoist: "${conflict.todoistContent}"`);
                }
                this.plugin.logOperation?.log('CACHE_REBUILT', `Found ${conflicts.length} conflicts during rebuild`);
                new Notice(`Cache rebuild: found ${conflicts.length} conflicted task(s). Sync disabled for those tasks. Use "Fix Database" in settings to resolve.`);
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
            await this.plugin.safeSettings?.update({ taskFileMapping: nextMapping }, true);
            
            // 构建结果消息
            const invalidMsg = invalidTaskIds.length > 0 ? ` (${invalidTaskIds.length} tasks not found in Todoist removed)` : '';
            const conflictMsg = conflicts.length > 0 ? ` (${conflicts.length} conflicts found, not processed)` : '';
            const convertedMsg = convertedCount > 0 ? ` (${convertedCount} legacy IDs converted)` : '';
            const message = `Cache rebuilt! ${processedCount} tasks processed.${convertedMsg}${invalidMsg}${conflictMsg}`;
            this.plugin.logOperation?.log('CACHE_REBUILT', `Cache rebuilt successfully! ${processedCount} tasks processed.${convertedMsg}${invalidMsg}${conflictMsg}`);
            if (noticeCallback) {
                noticeCallback(message);
            } else {
                this.plugin.debugLog(message);
            }
            
            return {
                success: true,
                tasksProcessed: processedCount,
                conflictsCount: conflicts.length,
                nonActiveCount,
                issueCount,
                convertedCount,
                tasksWithoutIdCount: tasksWithoutId.length,
            };
            
        } catch (error) {
            console.error('Cache rebuild failed:', error);
            this.plugin.logOperation?.log('CACHE_REBUILT', `Cache rebuild failed: ${(error as Error).message}`);
            // Restore backup mapping to avoid data loss
            console.warn('[rebuildCache] Restoring backup mapping due to failure...');
            await this.plugin.safeSettings?.update({ taskFileMapping: backupMapping }, true);
            const message = `Cache rebuild failed: ${(error as Error).message}`;
            if (noticeCallback) {
                noticeCallback(message);
            } else {
                new Notice(message);
            }
            return { success: false, tasksProcessed: 0, conflictsCount: 0, nonActiveCount: 0, issueCount: 0, convertedCount: 0, tasksWithoutIdCount: 0 };
        }
    }

    // ==========================================================================================
    // resolveConflicts - 解决冲突（辅助方法，暂未使用）
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



}
