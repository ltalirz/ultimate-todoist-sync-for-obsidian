/**
 * DatabaseChecker - 数据库一致性检查模块
 * 
 * 功能：检查 Vault、Todoist 和 taskFileMapping 三个数据源之间的一致性
 * 
 * 数据流：
 * 1. scanVaultTasks() - 扫描 Vault 中的所有任务
 * 2. getTodoistTasksFromSyncData() - 从 Todoist Sync API 获取任务
 * 3. compareThreeSources() - 比对三个数据源，找出不一致问题
 * 4. generateReport() - 生成 Markdown 格式的检查报告
 */

import { App } from 'obsidian';
import UltimateTodoistSyncForObsidian from '../main';

/**
 * 数据库检查问题类型定义
 * 用于描述检测到的各种数据不一致问题
 */
export interface DatabaseCheckIssue {
    type: 
        // ===== taskFileMapping 相关问题 =====
        | 'mapping_file_not_found'    // taskFileMapping 中记录的文件在 Vault 中不存在
        | 'mapping_task_not_in_todoist'  // taskFileMapping 中的 taskId 在 Todoist 中不存在（任务已删除或需要重建）
        | 'mapping_orphan'           // taskFileMapping 孤岛 - Todoist 和 Vault 都没有，只有 mapping 记录
        | 'vault_task_no_mapping'    // Vault 有任务但 taskFileMapping 没有记录（设置丢失）
        
        // ===== 数据一致性问题 =====
        | 'task_deleted_in_todoist'  // Vault+Mapping 有，但 Todoist 没有（任务在 Todoist 端被删除）
        | 'task_not_in_vault'        // Todoist+Mapping 有，但 Vault 文件不存在
        | 'new_task_not_synced'      // Vault 有但 Todoist 没有（新创建的任务尚未同步）
        | 'content_mismatch'         // 内容不一致
        | 'status_mismatch'          // 完成状态不一致
        | 'priority_mismatch'        // 优先级不一致
        | 'label_mismatch'          // 标签不一致
        | 'project_mismatch'         // 项目不一致
        | 'line_number_mismatch'     // 行号不一致
        | 'duplicate_task';          // 重复任务（同一文件多行同一任务）
    
    // 基本信息
    filePath?: string;              // 文件路径
    taskId?: string;                // 任务 ID
    details: string;                 // 问题详情描述
    lineNumber?: number;            // 行号（0-indexed）
    
    // 任务内容相关
    taskContent?: string;           // 任务内容（通用）
    obsidianContent?: string;       // Obsidian/Vault 中的任务内容
    todoistContent?: string;        // Todoist 中的任务内容
    
    // 状态相关
    obsidianStatus?: boolean;       // Obsidian 中的完成状态
    todoistStatus?: boolean;        // Todoist 中的完成状态
    
    // 日期相关
    dueDate?: string;               // 截止日期
    
    // 优先级相关
    priority?: number;              // 优先级（通用）
    obsidianPriority?: number;      // Obsidian 中的优先级
    todoistPriority?: number;      // Todoist 中的优先级
    
    // 项目相关
    projectId?: string;             // 项目 ID（通用）
    obsidianProjectId?: string;    // Obsidian 中的项目 ID
    todoistProjectId?: string;     // Todoist 中的项目 ID
    projectName?: string;           // 项目名称
    
    // 行号相关
    obsidianLineNumber?: number;   // Obsidian 中的行号
    mappingLineNumber?: number;    // taskFileMapping 中记录的行号
    
    // 标签相关
    labels?: string[];              // 标签（通用）
    obsidianLabels?: string[];     // Obsidian 中的标签
    todoistLabels?: string[];      // Todoist 中的标签
}

/**
 * Vault 任务数据结构
 * 表示从 Obsidian Vault 中扫描到的任务
 */
export interface VaultTask {
    taskId: string;                 // 任务 ID（来自 todoist_id 元数据）
    content: string;                // 任务内容（已去除元数据）
    isCompleted: boolean;           // 是否已完成
    filePath: string;              // 任务所在文件路径
    lineNumber: number;            // 任务所在行号（0-indexed）
    labels: string[];              // 任务标签（#tag 格式）
}



/**
 * Todoist 任务数据结构
 * 表示从 Todoist API 获取的任务
 */
export interface TodoistTask {
    taskId: string;                 // 任务 ID
    content: string;                // 任务内容
    checked: boolean;           // 是否已完成
    dueDate?: string;              // 截止日期
    priority: number;               // 优先级 (1-4, 1 最高)
    projectId: string;              // 项目 ID
    labels: string[];              // 标签数组
}

/**
 * 数据库检查结果
 * 包含检查是否成功、问题数量、问题列表和统计摘要
 */
export interface DatabaseCheckResult {
    success: boolean;               // 检查是否通过（无问题）
    totalIssues: number;            // 问题总数
    issues: DatabaseCheckIssue[];   // 问题列表
    summary: {                      // 统计摘要
        // taskFileMapping 相关
        mappingFileNotFound: number;        // taskFileMapping 中的文件不存在
        mappingTaskNotInTodoist: number;   // taskFileMapping 中的任务在 Todoist 不存在
        mappingOrphan: number;              // 孤岛 mapping
        vaultTaskNoMapping: number;         // Vault 任务没有 mapping
        
        // 数据一致性
        taskDeletedInTodoist: number;       // 任务在 Todoist 端被删除
        taskNotInVault: number;             // Vault 文件丢失
        newTaskNotSynced: number;           // 新任务未同步
        contentMismatch: number;             // 内容不一致
        statusMismatch: number;              // 状态不一致
        priorityMismatch: number;            // 优先级不一致
        labelMismatch: number;               // 标签不一致
        projectMismatch: number;            // 项目不一致
        lineNumberMismatch: number;         // 行号不一致
        duplicateTask: number;              // 重复任务
    };
    reportPath?: string;             // 生成的报告文件路径
}

/**
 * DatabaseChecker 类
 * 
 * 主要功能：
 * 1. 扫描 Vault 中的任务
 * 2. 从 Todoist 获取任务数据
 * 3. 比对三个数据源（Vault、Todoist、taskFileMapping）
 * 4. 生成详细的检查报告
 */
export class DatabaseChecker {
    // Obsidian App 实例
    app: App;
    // 插件主实例
    plugin: UltimateTodoistSyncForObsidian;

    /**
     * 构造函数
     * @param app - Obsidian App 实例
     * @param plugin - 插件主实例
     */
    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    /**
     * 主检查方法 - 执行完整的数据库一致性检查
     * 
     * 执行流程：
     * 1. 扫描 Vault 中的所有任务
     * 2. 从 Todoist Sync API 获取任务
     * 3. 加载 taskFileMapping
     * 4. 比对三个数据源
     * 5. 生成检查报告
     * 
     * @param noticeCallback - 可选的进度回调函数
     * @returns DatabaseCheckResult - 检查结果
     */
    async checkDatabase(noticeCallback?: (message: string) => void): Promise<DatabaseCheckResult> {
        // 初始化问题列表
        const issues: DatabaseCheckIssue[] = [];
        
        // 初始化统计摘要（各类型问题计数）
        const summary = {
            mappingFileNotFound: 0,           // taskFileMapping 文件不存在
            mappingTaskNotInTodoist: 0,       // taskFileMapping 任务在 Todoist 不存在
            mappingOrphan: 0,                 // 孤岛 mapping
            vaultTaskNoMapping: 0,            // Vault 任务无 mapping
            taskDeletedInTodoist: 0,          // 任务在 Todoist 被删除
            taskNotInVault: 0,                // Vault 文件丢失
            newTaskNotSynced: 0,              // 新任务未同步
            contentMismatch: 0,                // 内容不一致
            statusMismatch: 0,                 // 状态不一致
            priorityMismatch: 0,              // 优先级不一致
            labelMismatch: 0,                 // 标签不一致
            projectMismatch: 0,               // 项目不一致
            lineNumberMismatch: 0,            // 行号不一致
            duplicateTask: 0                  // 重复任务
        };

        // 发送开始检查的通知
        if (noticeCallback) {
            noticeCallback('Starting data consistency check...');
        }

        try {
            // ====== Step 1: 扫描 Vault 任务 ======
            if (noticeCallback) {
                noticeCallback('Step 1/4: Scanning vault files...');
            }
            // 扫描 Vault 中的所有任务，建立 taskId -> VaultTask 的映射
            const vaultTasksMap = await this.scanVaultTasks();

            // ====== Step 2: 获取 Todoist 任务 ======
            if (noticeCallback) {
                noticeCallback('Step 2/4: Loading Todoist data from syncData...');
            }
            // 获取 syncData（如果未加载则先初始化）
            let syncData = this.plugin.todoistSyncAPI.getSyncData();
            if (!syncData) {
                // 如果 syncData 为空，初始化同步
                await this.plugin.todoistSyncAPI.initializeSync();
                // 重新获取 syncData
                syncData = this.plugin.todoistSyncAPI.getSyncData();
            }
            // 从 syncData 中解析出 Todoist 任务
            const todoistTasksMap = this.getTodoistTasksFromSyncData(syncData);

            // ====== Step 3: 获取 taskFileMapping ======
            if (noticeCallback) {
                noticeCallback('Step 3/4: Loading taskFileMapping...');
            }
            // 从设置中获取 taskFileMapping（任务 ID -> 文件路径和行号的映射）
            const taskFileMapping = this.plugin.settings.taskFileMapping || {};

            // ====== Step 4: 分析差异 ======
            if (noticeCallback) {
                noticeCallback('Step 4/4: Analyzing differences...');
            }

            // 比对三个数据源，找出所有不一致问题
            const result = await this.compareThreeSources(
                vaultTasksMap,
                todoistTasksMap,
                taskFileMapping
            );
            
            // 将发现的问题添加到结果中
            issues.push(...result.issues);
            // 合并统计摘要
            Object.assign(summary, result.summary);

            // 计算问题总数
            const totalIssues = Object.values(summary).reduce((a, b) => a + b, 0);
            // 记录日志
            this.plugin.logOperation?.log('DATABASE_CHECKED', `Database check completed: ${totalIssues} issues found`);

            // ====== 生成报告 ======
            const reportPath = await this.generateReport({
                success: totalIssues === 0,
                totalIssues,
                issues,
                summary
            });

            // 返回检查结果
            return {
                success: totalIssues === 0,
                totalIssues,
                issues,
                summary,
                reportPath
            };
        } catch (error) {
            // 检查失败，记录错误日志
            this.plugin.logOperation?.log('DATABASE_CHECK', `Database check failed: ${(error as Error).message}`);
            // 返回失败结果
            return {
                success: false,
                totalIssues: 0,
                issues: [{
                    type: 'task_not_in_vault',
                    details: `Database check failed: ${(error as Error).message}`
                }],
                summary,
                reportPath: undefined
            };
        }
    }

    /**
     * 扫描 Vault 中的所有任务
     * 
     * 扫描逻辑：
     * 1. 获取所有 .md 文件
     * 2. 遍历每个文件的每一行
     * 3. 查找包含 #todoist 标签的行
     * 4. 提取 todoist_id 元数据作为任务 ID
     * 5. 使用 taskParser 提取任务内容
     * 
     * @returns Map<string, VaultTask> - taskId 到 VaultTask 的映射
     */
    async scanVaultTasks(): Promise<Map<string, VaultTask>> {
        // 创建 taskId -> VaultTask 的映射
        const vaultTasksMap = new Map<string, VaultTask>();
        
        // 获取所有 Markdown 文件
        const files = this.app.vault.getFiles().filter(f => f.extension === 'md');

        // 遍历每个文件
        for (const file of files) {
            try {
                // 读取文件内容
                const content = await this.app.vault.cachedRead(file);
                // 按行分割
                const lines = content.split('\n');

                // 遍历每一行
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    
                    // 检查是否包含 #todoist 标签
                    if (line.includes('#todoist')) {
                        // 使用正则提取 todoist_id 元数据
                        const match = line.match(/%%\[todoist_id::\s*([\w-]+)\]%%/);
                        
                        // 如果找到 todoist_id
                        if (match && match[1]) {
                            const taskId = match[1];  // 提取任务 ID
                            
                            // 使用 taskParser 提取任务内容（去除元数据、链接、标签等）
                            const taskContent = this.plugin.taskParser.getTaskContentFromLineText(line);
                            
                            // 检查任务是否已完成（[x] 表示已完成）
                            const isCompleted = /\[x\]/i.test(line);
                            
                            // 提取标签（#tag 格式）
                            const labels = this.extractLabelsFromLine(line);

                            // 如果 taskId 已存在，跳过（避免重复）
                            if (vaultTasksMap.has(taskId)) {
                                continue;
                            }

                            // 将任务添加到映射中
                            vaultTasksMap.set(taskId, {
                                taskId,
                                content: taskContent,
                                isCompleted,
                                filePath: file.path,
                                lineNumber: i,
                                labels
                            });
                        }
                    }
                }
            } catch (error) {
                // 读取文件失败，记录错误
                console.error(`Error reading file ${file.path}:`, error);
            }
        }

        return vaultTasksMap;
    }


    

    /**
     * 从 syncData 中获取 Todoist 任务
     * 
     * 此方法是 checkDatabase 的主要数据来源
     * 相比 fetchTodoistTasks 直接使用本地缓存，性能更好
     * 
     * @param syncData - Todoist Sync API 返回的原始数据
     * @returns Map<string, TodoistTask> - taskId 到 TodoistTask 的映射
     */
    getTodoistTasksFromSyncData(syncData: Record<string, any> | null): Map<string, TodoistTask> {
        const todoistTasksMap = new Map<string, TodoistTask>();
        
        // 检查 syncData 是否有效
        if (!syncData || !syncData.items) {
            return todoistTasksMap;
        }
        
        // 遍历 syncData 中的所有任务
        for (const task of syncData.items) {
            if (!task) continue;
            const taskAny = task as any;
            
            // 将任务添加到映射
            todoistTasksMap.set(task.id, {
                taskId: task.id,
                content: task.content || '',
                // 判断完成状态
                checked: (taskAny as any).checked || false,
                dueDate: task.due?.date,
                priority: task.priority || 4,
                projectId: task.projectId || '',
                labels: task.labels || []
            });
        }

        return todoistTasksMap;
    }

    /**
     * 比较三个数据源，找出所有不一致问题
     * 
     * 三个数据源：
     * 1. vaultTasksMap - Vault 中扫描到的任务
     * 2. todoistTasksMap - Todoist 中的任务
     * 3. taskFileMapping - 任务 ID 到文件路径的映射
     * 
     * 8 种组合情况：
     * | 情况 | Vault | Todoist | Mapping | 说明 |
     * |------|-------|---------|---------|------|
     * | 1    | ✓     | ✓       | ✓       | 全部存在，检查一致性 |
     * | 2    | ✓     | ✓       | ✗       | mapping 丢失 |
     * | 3    | ✓     | ✗       | ✓       | 任务在 Todoist 被删除 |
     * | 4    | ✓     | ✗       | ✗       | 新任务未同步 |
     * | 5    | ✗     | ✓       | ✓       | Vault 文件丢失 |
     * | 6    | ✗     | ✓       | ✗       | 其他设备添加的任务（正常）|
     * | 7    | ✗     | ✗       | ✓       | mapping 孤岛 |
     * | 8    | ✗     | ✗       | ✗       | 不可能情况 |
     * 
     * @param vaultTasksMap - Vault 任务映射
     * @param todoistTasksMap - Todoist 任务映射
     * @param taskFileMapping - taskFileMapping 映射
     * @returns 问题和统计摘要
     */
    async compareThreeSources(
        vaultTasksMap: Map<string, VaultTask>,
        todoistTasksMap: Map<string, TodoistTask>,
        taskFileMapping: Record<string, { filePath: string; lineNumber: number }>
    ): Promise<{ issues: DatabaseCheckIssue[], summary: DatabaseCheckResult['summary'] }> {
        // 初始化问题列表
        const issues: DatabaseCheckIssue[] = [];
        
        // 初始化统计摘要
        const summary = {
            mappingFileNotFound: 0,
            mappingTaskNotInTodoist: 0,
            mappingOrphan: 0,
            vaultTaskNoMapping: 0,
            taskDeletedInTodoist: 0,
            taskNotInVault: 0,
            newTaskNotSynced: 0,
            contentMismatch: 0,
            statusMismatch: 0,
            priorityMismatch: 0,
            labelMismatch: 0,
            projectMismatch: 0,
            lineNumberMismatch: 0,
            duplicateTask: 0
        };

        // 获取 Vault 中所有文件路径（用于验证 taskFileMapping）
        const vaultFiles = new Set(this.app.vault.getFiles().map(f => f.path));

        // ====== Part 1: 检查 taskFileMapping 的有效性 ======
        
        // 遍历 taskFileMapping 中的每条记录
        for (const [taskId, mapping] of Object.entries(taskFileMapping)) {
            // 检查文件是否存在
            if (!vaultFiles.has(mapping.filePath)) {
                issues.push({
                    type: 'mapping_file_not_found',
                    filePath: mapping.filePath,
                    taskId,
                    lineNumber: mapping.lineNumber,
                    details: `Mapping references file "${mapping.filePath}" which does not exist in vault`
                });
                summary.mappingFileNotFound++;
            }

            // 检查任务是否存在于 Todoist
            if (!todoistTasksMap.has(taskId)) {
                issues.push({
                    type: 'mapping_task_not_in_todoist',
                    filePath: mapping.filePath,
                    taskId,
                    lineNumber: mapping.lineNumber,
                    details: `Mapping task "${taskId}" does not exist in Todoist (deleted in Todoist or ID needs rebuild)`
                });
                summary.mappingTaskNotInTodoist++;
            }
        }

        // ====== Part 2: 收集所有任务 ID ======
        
        // 合并三个数据源中的所有任务 ID
        const allTaskIds = new Set<string>();
        for (const taskId of vaultTasksMap.keys()) allTaskIds.add(taskId);
        for (const taskId of todoistTasksMap.keys()) allTaskIds.add(taskId);
        for (const taskId of Object.keys(taskFileMapping)) allTaskIds.add(taskId);

        // ====== Part 3: 分析每个任务的组合情况 ======
        
        for (const taskId of allTaskIds) {
            // 获取三个数据源中该任务的状态
            const vaultTask = vaultTasksMap.get(taskId);
            const todoistTask = todoistTasksMap.get(taskId);
            const mapping = taskFileMapping[taskId];

            // 判断任务在各个数据源中的存在状态
            const inVault = !!vaultTask;
            const inTodoist = !!todoistTask;
            const inMapping = !!mapping;

            // ============ 8 种组合情况 ============

            // ====== 情况 2: Vault ✓ + Todoist ✓ + Mapping ✗ ======
            // 说明：任务在 Vault 和 Todoist 都存在，但 taskFileMapping 丢失
            // 解决方案：需要重建 mapping
            if (inVault && inTodoist && !inMapping) {
                issues.push({
                    type: 'vault_task_no_mapping',
                    filePath: vaultTask!.filePath,
                    taskId,
                    lineNumber: vaultTask!.lineNumber,
                    details: `Task exists in Vault and Todoist but no mapping in settings (settings lost or needs rebuild)`,
                    obsidianContent: vaultTask!.content,
                    todoistContent: todoistTask!.content,
                    obsidianStatus: vaultTask!.isCompleted,
                    todoistStatus: (todoistTask as any).checked || false
                });
                summary.vaultTaskNoMapping++;
            }

            // ====== 情况 3: Vault ✓ + Todoist ✗ + Mapping ✓ ======
            // 说明：任务在 Vault 和 taskFileMapping 中存在，但在 Todoist 中不存在
            // 可能原因：任务在 Todoist 端被删除，或者 legacy ID 需要重建
            else if (inVault && !inTodoist && inMapping) {
                issues.push({
                    type: 'task_deleted_in_todoist',
                    filePath: vaultTask!.filePath,
                    taskId,
                    lineNumber: vaultTask!.lineNumber,
                    details: `Task exists in Vault and mapping but was deleted in Todoist (or needs rebuild)`,
                    obsidianContent: vaultTask!.content,
                    obsidianStatus: vaultTask!.isCompleted
                });
                summary.taskDeletedInTodoist++;
            }

            // ====== 情况 4: Vault ✓ + Todoist ✗ + Mapping ✗ ======
            // 说明：任务在 Vault 中存在，但在 Todoist 和 taskFileMapping 中都不存在
            // 可能原因：新创建的任务尚未同步到 Todoist
            else if (inVault && !inTodoist && !inMapping) {
                issues.push({
                    type: 'new_task_not_synced',
                    filePath: vaultTask!.filePath,
                    taskId,
                    lineNumber: vaultTask!.lineNumber,
                    details: `New task in Vault not yet synced to Todoist`,
                    obsidianContent: vaultTask!.content,
                    obsidianStatus: vaultTask!.isCompleted
                });
                summary.newTaskNotSynced++;
            }

            // ====== 情况 5: Vault ✗ + Todoist ✓ + Mapping ✓ ======
            // 说明：任务在 Todoist 和 taskFileMapping 中存在，但 Vault 文件丢失
            // 可能原因：文件被删除或移动
            else if (!inVault && inTodoist && inMapping) {
                issues.push({
                    type: 'task_not_in_vault',
                    filePath: mapping.filePath,
                    taskId,
                    lineNumber: mapping.lineNumber,
                    details: `Task exists in Todoist and mapping but Vault file is missing (file deleted or moved)`,
                    todoistContent: todoistTask!.content,
                    todoistStatus: (todoistTask as any).checked || false
                });
                summary.taskNotInVault++;
            }

            // ====== 情况 6: Vault ✗ + Todoist ✓ + Mapping ✗ ======
            // 说明：任务只在 Todoist 中存在
            // 可能原因：其他设备添加的任务（正常情况，不记录为问题）
            else if (!inVault && inTodoist && !inMapping) {
                // 这是正常情况 - 任务是从其他设备添加的
                // 不记录为问题
            }

            // ====== 情况 7: Vault ✗ + Todoist ✗ + Mapping ✓ ======
            // 说明：只有 taskFileMapping 存在，任务在 Vault 和 Todoist 都不存在
            // 这是孤岛 mapping，需要清理
            else if (!inVault && !inTodoist && inMapping) {
                issues.push({
                    type: 'mapping_orphan',
                    filePath: mapping.filePath,
                    taskId,
                    lineNumber: mapping.lineNumber,
                    details: `Mapping exists but task is deleted in both Vault and Todoist (orphan mapping)`,
                    mappingLineNumber: mapping.lineNumber
                });
                summary.mappingOrphan++;
            }

            // ====== 情况 1: Vault ✓ + Todoist ✓ + Mapping ✓ ======
            // 说明：三个数据源都存在，这是正常情况
            // 需要进一步检查数据一致性
            else if (inVault && inTodoist && inMapping) {
                // ---- 检查行号一致性 ----
                if (vaultTask!.lineNumber !== mapping.lineNumber) {
                    issues.push({
                        type: 'line_number_mismatch',
                        filePath: vaultTask!.filePath,
                        taskId,
                        lineNumber: vaultTask!.lineNumber,
                        obsidianLineNumber: vaultTask!.lineNumber,
                        mappingLineNumber: mapping.lineNumber,
                        details: `Line number mismatch: Vault line ${vaultTask!.lineNumber + 1}, Mapping line ${mapping.lineNumber + 1}`
                    });
                    summary.lineNumberMismatch++;
                }

                // ---- 检查内容一致性 ----
                // 注意：这里直接比较可能有问题，因为 Vault 内容是处理过的
                if (vaultTask!.content.trim() !== todoistTask!.content.trim()) {
                    issues.push({
                        type: 'content_mismatch',
                        filePath: vaultTask!.filePath,
                        taskId,
                        lineNumber: vaultTask!.lineNumber,
                        details: `Task content differs between Vault and Todoist`,
                        obsidianContent: vaultTask!.content.substring(0, 100),
                        todoistContent: todoistTask!.content.substring(0, 100)
                    });
                    summary.contentMismatch++;
                }

                // ---- 检查完成状态一致性 ----
                if (vaultTask!.isCompleted !== (todoistTask as any).checked) {
                    issues.push({
                        type: 'status_mismatch',
                        filePath: vaultTask!.filePath,
                        taskId,
                        lineNumber: vaultTask!.lineNumber,
                        details: `Status mismatch: Vault is ${vaultTask!.isCompleted ? 'completed' : 'incomplete'}, Todoist is ${(todoistTask as any).checked ? 'completed' : 'incomplete'}`,
                        obsidianStatus: vaultTask!.isCompleted,
                    todoistStatus: (todoistTask as any).checked || false
                    });
                    console.log(vaultTask)
                    console.log(todoistTask)
                    summary.statusMismatch++;
                }

                // ---- 检查优先级一致性 ----
                // 从 Vault 标签中推断优先级（p1=最高, p4=最低）
                const vaultPriority = 5 - (vaultTask!.labels?.some(l => l.startsWith('p1')) ? 1 : 
                                           vaultTask!.labels?.some(l => l.startsWith('p2')) ? 2 : 
                                           vaultTask!.labels?.some(l => l.startsWith('p3')) ? 3 : 4) || 4;
                if (vaultPriority !== todoistTask!.priority) {
                    issues.push({
                        type: 'priority_mismatch',
                        filePath: vaultTask!.filePath,
                        taskId,
                        lineNumber: vaultTask!.lineNumber,
                        details: `Priority mismatch: Vault is ${vaultPriority}, Todoist is ${todoistTask!.priority}`,
                        obsidianPriority: vaultPriority,
                        todoistPriority: todoistTask!.priority
                    });
                    console.log(vaultTask)
                    console.log(todoistTask)
                    summary.priorityMismatch++;
                }

                // ---- 检查标签一致性 ----
                const obsidianLabels = vaultTask!.labels || [];
                const todoistLabels = todoistTask!.labels || [];
                // 比较标签差异
                const labelDiff = obsidianLabels.filter(l => !todoistLabels.includes(l)).length > 0 ||
                                 todoistLabels.filter(l => !obsidianLabels.includes(l)).length > 0;
                if (labelDiff) {
                    issues.push({
                        type: 'label_mismatch',
                        filePath: vaultTask!.filePath,
                        taskId,
                        lineNumber: vaultTask!.lineNumber,
                        details: `Labels differ: Vault [${obsidianLabels.join(', ')}], Todoist [${todoistLabels.join(', ')}]`,
                        obsidianLabels,
                        todoistLabels
                    });
                    console.log(vaultTask)
                    console.log(todoistTask)
                    summary.labelMismatch++;
                }

                // ---- 检查项目一致性（可选）----
                // 从 fileMetadata 中获取默认项目 ID
                if (mapping && vaultTask!.filePath) {
                    const fileMetadata = this.plugin.settings.fileMetadata?.[vaultTask!.filePath];
                    const mappingProjectId = fileMetadata?.defaultProjectId;
                    // 如果映射中指定了项目 ID，检查是否与 Todoist 一致
                    if (mappingProjectId && mappingProjectId !== todoistTask!.projectId) {
                        issues.push({
                            type: 'project_mismatch',
                            filePath: vaultTask!.filePath,
                            taskId,
                            lineNumber: vaultTask!.lineNumber,
                            details: `Project differs: Mapping project is ${mappingProjectId}, Todoist is ${todoistTask!.projectId}`,
                            obsidianProjectId: mappingProjectId,
                            todoistProjectId: todoistTask!.projectId
                        });
                        console.log(vaultTask)
                        console.log(todoistTask)
                        summary.projectMismatch++;
                    }
                }
            }
        }

        return { issues, summary };
    }

    /**
     * 从任务行中提取标签
     * 
     * 提取逻辑：
     * 使用正则匹配所有 #tag 格式的标签
     * 排除 #todoist 标签（这是同步标记，不是用户标签）
     * 
     * @param line - 任务行文本
     * @returns string[] - 标签数组（不含 # 前缀）
     */
    private extractLabelsFromLine(line: string): string[] {
        const labels: string[] = [];
        // 匹配 # 后面跟着字母、数字、下划线、连字符或中文
        const labelRegex = /#[\w\u4e00-\u9fa5-]+/g;
        let match;
        
        // 遍历所有匹配的标签
        while ((match = labelRegex.exec(line)) !== null) {
            // 添加标签（不含 # 前缀）
            labels.push(match[0].substring(1));
        }
        return labels;
    }

    /**
     * 生成数据库检查报告
     * 
     * 报告格式：Markdown
     * 包含内容：
     * 1. 检查状态摘要
     * 2. 数据源概览表格
     * 3. 各类问题的详细列表
     * 4. 内容/状态/优先级/标签/行号等详细对比信息
     * 
     * @param result - 数据库检查结果
     * @returns string | undefined - 报告文件路径，失败时返回 undefined
     */
    async generateReport(result: DatabaseCheckResult): Promise<string | undefined> {
        // 生成时间戳作为文件名的一部分
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportFilename = `ultimate-todoist-sync-database-check-${timestamp}.md`;

        // 从问题中提取统计数据
        const vaultTasksWithMapping = result.issues.filter(i => 
            (i.type === 'content_mismatch' || i.type === 'status_mismatch' || 
             i.type === 'priority_mismatch' || i.type === 'label_mismatch' ||
             i.type === 'project_mismatch' || i.type === 'line_number_mismatch')
        ).length;
        
        const vaultNoMapping = result.summary.vaultTaskNoMapping;
        const taskDeletedInTodoist = result.summary.taskDeletedInTodoist;
        const newTaskNotSynced = result.summary.newTaskNotSynced;
        const taskNotInVault = result.summary.taskNotInVault;
        const mappingOrphan = result.summary.mappingOrphan;
        const mappingFileNotFound = result.summary.mappingFileNotFound;
        const mappingTaskNotInTodoist = result.summary.mappingTaskNotInTodoist;

        // 生成 Markdown 报告内容
        let markdown = `# Database Check Report

Generated: ${new Date().toLocaleString()}

## Summary

| Status | Total Issues |
|--------|--------------|
| ${result.success ? '✅ Passed' : '❌ Issues Found'} | ${result.totalIssues} |

---

## Data Sources Overview

| Combination | Vault | Todoist | Mapping | Count | Description |
|-------------|-------|---------|---------|-------|-------------|
| Normal | ✅ | ✅ | ✅ | ${vaultTasksWithMapping} | All present, check consistency |
| Settings Lost | ✅ | ✅ | ❌ | ${vaultNoMapping} | Need rebuild mapping |
| Deleted in Todoist | ✅ | ❌ | ✅ | ${taskDeletedInTodoist} | Task deleted in Todoist |
| Not Synced | ✅ | ❌ | ❌ | ${newTaskNotSynced} | New task not yet synced |
| File Missing | ❌ | ✅ | ✅ | ${taskNotInVault} | Vault file missing |
| Orphan Mapping | ❌ | ❌ | ✅ | ${mappingOrphan} | Mapping orphan |
| Mapping File Not Found | - | - | - | ${mappingFileNotFound} | Mapping file doesn't exist |
| Mapping Task Not in Todoist | - | - | - | ${mappingTaskNotInTodoist} | Task deleted in Todoist |

---

## Detailed Issues

`;
        // 如果没有问题
        if (result.issues.length === 0) {
            markdown += '*No issues found. Database is healthy.*\n';
        } else {
            // 按问题类型分组
            const groupedByType = new Map<string, DatabaseCheckIssue[]>();
            for (const issue of result.issues) {
                if (!groupedByType.has(issue.type)) {
                    groupedByType.set(issue.type, []);
                }
                groupedByType.get(issue.type)!.push(issue);
            }

            // 问题类型标签映射
            const typeLabels: Record<string, string> = {
                'mapping_file_not_found': 'Mapping File Not Found',
                'mapping_task_not_in_todoist': 'Mapping Task Not in Todoist',
                'mapping_orphan': 'Mapping Orphan',
                'vault_task_no_mapping': 'Vault Task No Mapping (Settings Lost)',
                'task_deleted_in_task_deleted_in_todoist': 'Task Deleted in Todoist',
                'task_not_in_vault': 'Task Not in Vault (File Missing)',
                'new_task_not_synced': 'New Task Not Synced',
                'content_mismatch': 'Content Mismatch',
                'status_mismatch': 'Status Mismatch',
                'priority_mismatch': 'Priority Mismatch',
                'label_mismatch': 'Label Mismatch',
                'project_mismatch': 'Project Mismatch',
                'line_number_mismatch': 'Line Number Mismatch',
                'duplicate_task': 'Duplicate Task'
            };

            // 优先级标签映射
            const priorityLabels: Record<number, string> = {
                1: 'P1 (Low)',
                2: 'P2 (Medium)',
                3: 'P3 (High)',
                4: 'P4 (Urgent)'
            };

            // 输出每种问题类型
            for (const [type, issues] of groupedByType) {
                const label = typeLabels[type] || type;
                markdown += `### ${label} (${issues.length})\n\n`;

                // 创建该问题类型的表格
                markdown += `| # | Task ID | Content | File | Line | Status | Details |\n`;
                markdown += `|---|---------|---------|------|------|--------|---------|\n`;
                
                // 遍历每个问题
                for (let i = 0; i < issues.length; i++) {
                    const issue = issues[i];
                    // 截取任务内容
                    const taskContent = issue.taskContent?.substring(0, 30) || issue.obsidianContent?.substring(0, 30) || '-';
                    // 提取文件名
                    const filePath = issue.filePath ? issue.filePath.split('/').pop() : '-';
                    // 行号格式化
                    const lineNum = issue.lineNumber !== undefined ? String(issue.lineNumber + 1) : '-';
                    
                    // 状态列
                    let statusCol = '';
                    if (issue.obsidianStatus !== undefined && issue.todoistStatus !== undefined) {
                        const obs = issue.obsidianStatus ? '✅' : '⬜';
                        const todo = issue.todoistStatus ? '✅' : '⬜';
                        statusCol = `Obs:${obs} Todo:${todo}`;
                    } else if (issue.obsidianStatus !== undefined) {
                        statusCol = issue.obsidianStatus ? '✅' : '⬜';
                    } else if (issue.todoistStatus !== undefined) {
                        statusCol = issue.todoistStatus ? '✅' : '⬜';
                    } else {
                        statusCol = '-';
                    }

                    const details = issue.details.substring(0, 40);
                    
                    markdown += `| ${i + 1} | \`${issue.taskId || '-'}\` | ${taskContent} | ${filePath} | ${lineNum} | ${statusCol} | ${details} |\n`;
                }
                markdown += '\n';

                // 为内容不一致问题添加详细对比
                if (type === 'content_mismatch') {
                    markdown += `#### Content Details\n\n`;
                    for (let i = 0; i < Math.min(issues.length, 10); i++) {
                        const issue = issues[i];
                        markdown += `**Task \`${issue.taskId}\`:**\n`;
                        if (issue.obsidianContent) {
                            markdown += `- **Vault:** ${issue.obsidianContent}\n`;
                        }
                        if (issue.todoistContent) {
                            markdown += `- **Todoist:** ${issue.todoistContent}\n`;
                        }
                        markdown += '\n';
                    }
                    if (issues.length > 10) {
                        markdown += `*... and ${issues.length - 10} more*\n\n`;
                    }
                }

                // 为状态不一致问题添加详细对比
                if (type === 'status_mismatch') {
                    markdown += `#### Status Details\n\n`;
                    for (let i = 0; i < Math.min(issues.length, 10); i++) {
                        const issue = issues[i];
                        const obsStatus = issue.obsidianStatus ? 'Completed' : 'Incomplete';
                        const todoStatus = issue.todoistStatus ? 'Completed' : 'Incomplete';
                        markdown += `- **\`${issue.taskId}\`**: Vault is **${obsStatus}**, Todoist is **${todoStatus}**\n`;
                    }
                    if (issues.length > 10) {
                        markdown += `*... and ${issues.length - 10} more*\n`;
                    }
                    markdown += '\n';
                }

                // 为优先级不一致问题添加详细对比
                if (type === 'priority_mismatch') {
                    markdown += `#### Priority Details\n\n`;
                    for (let i = 0; i < Math.min(issues.length, 10); i++) {
                        const issue = issues[i];
                        const obsP = priorityLabels[issue.obsidianPriority || 4] || `P${issue.obsidianPriority || 4}`;
                        const todoP = priorityLabels[issue.todoistPriority || 4] || `P${issue.todoistPriority || 4}`;
                        markdown += `- **\`${issue.taskId}\`**: Vault is **${obsP}**, Todoist is **${todoP}**\n`;
                    }
                    if (issues.length > 10) {
                        markdown += `*... and ${issues.length - 10} more*\n`;
                    }
                    markdown += '\n';
                }

                // 为标签不一致问题添加详细对比
                if (type === 'label_mismatch') {
                    markdown += `#### Label Details\n\n`;
                    for (let i = 0; i < Math.min(issues.length, 10); i++) {
                        const issue = issues[i];
                        const obsLabels = issue.obsidianLabels?.join(', ') || 'none';
                        const todoLabels = issue.todoistLabels?.join(', ') || 'none';
                        markdown += `- **\`${issue.taskId}\`**: Vault has **[${obsLabels}]**, Todoist has **[${todoLabels}]**\n`;
                    }
                    if (issues.length > 10) {
                        markdown += `*... and ${issues.length - 10} more*\n`;
                    }
                    markdown += '\n';
                }

                // 为行号不一致问题添加详细对比
                if (type === 'line_number_mismatch') {
                    markdown += `#### Line Number Details\n\n`;
                    for (let i = 0; i < Math.min(issues.length, 10); i++) {
                        const issue = issues[i];
                        markdown += `- **\`${issue.taskId}\`**: Vault line **${(issue.obsidianLineNumber || 0) + 1}**, Mapping line **${(issue.mappingLineNumber || 0) + 1}**\n`;
                    }
                    if (issues.length > 10) {
                        markdown += `*... and ${issues.length - 10} more*\n`;
                    }
                    markdown += '\n';
                }
            }
        }

        markdown += `---

*Report generated by Ultimate Todoist Sync for Obsidian*
`;

        try {
            // 在 Vault 根目录创建报告文件
            const reportPath = reportFilename;
            await this.app.vault.create(reportPath, markdown);

            this.plugin.logOperation?.log('DATABASE_CHECK', `Report saved to ${reportPath}`);
            return reportPath;
        } catch (error) {
            console.error('Failed to save report:', error);
            this.plugin.logOperation?.log('DATABASE_CHECK', `Failed to save report: ${(error as Error).message}`);
            return undefined;
        }
    }
}
