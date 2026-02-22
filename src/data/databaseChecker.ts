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
import UltimateTodoistSyncForObsidian from '../../main';

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
        | 'task_nonactive'           // Vault 已完成 + Todoist 不存在 + 已被标记为 nonActive（已知状态）
        | 'task_issue'               // Vault 未完成 + Todoist 不存在 + 已被标记为 issue（异常状态）
        | 'unknown_issue'            // Vault 有但 mapping 和 Todoist 都没有（未知问题）
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
        taskNonActive: number;              // 已标记为 nonActive 的任务
        taskIssue: number;                  // 已标记为 issue 的任务
        unknownIssue: number;               // 未知问题
        contentMismatch: number;             // 内容不一致
        statusMismatch: number;              // 状态不一致
        priorityMismatch: number;            // 优先级不一致
        labelMismatch: number;               // 标签不一致
        projectMismatch: number;            // 项目不一致
        lineNumberMismatch: number;         // 行号不一致
        duplicateTask: number;              // 重复任务
    };
    reportPath?: string;             // 生成的报告文件路径
    step1Stats?: {                  // 第一步 Vault vs Mapping 组合统计
        vaultWithMapping: number;
        vaultWithoutMapping: number;
        orphanMapping: number;
        unknownIssue: number;
    };
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
            taskNonActive: 0,                 // 已标记为 nonActive 的任务
            taskIssue: 0,                     // 已标记为 issue 的任务
            unknownIssue: 0,                  // 未知问题
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
            // 使用 fileOperation 的统一扫描方法
            const { tasksWithId, tasksWithoutId } = await this.plugin.fileOperation.scanVaultTasks();
            const vaultTasksMap = tasksWithId;

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
            // 使用 fileOperation 的方法从 syncData 中获取 Todoist 任务
            const todoistTasksMap = this.plugin.fileOperation.getTodoistTasksFromSyncData(syncData);

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

            // 第一步 Vault vs Mapping 组合统计
            const step1Stats = {
                vaultWithMapping: result.vaultWithMappingCount,
                vaultWithoutMapping: result.vaultWithoutMappingCount,
                orphanMapping: result.orphanMappingCount,
                unknownIssue: result.unknownIssueCount
            };
            
            // ====== Step 5: 处理无 todoist_id 的任务（新任务未同步）======
            if (tasksWithoutId.length > 0) {
                for (const newTask of tasksWithoutId) {
                    issues.push({
                        type: 'new_task_not_synced',
                        filePath: newTask.filePath,
                        taskId: undefined,
                        lineNumber: newTask.lineNumber,
                        details: `New task in Vault not yet synced to Todoist (no todoist_id)`,
                        obsidianContent: newTask.content,
                        obsidianStatus: newTask.isCompleted
                    });
                    summary.newTaskNotSynced++;
                }
            }
            
            // 将发现的问题添加到结果中
            issues.push(...result.issues);
            // 累加统计摘要（不能用 Object.assign，会覆盖已有计数）
            for (const key of Object.keys(result.summary) as Array<keyof typeof summary>) {
                summary[key] += result.summary[key];
            }

            // 计算问题总数
            const totalIssues = Object.values(summary).reduce((a, b) => a + b, 0);
            // 记录日志
            this.plugin.logOperation?.log('DATABASE_CHECKED', `Database check completed: ${totalIssues} issues found`);

            // ====== 生成报告 ======
            const reportPath = await this.generateReport({
                success: totalIssues === 0,
                totalIssues,
                issues,
                summary,
                step1Stats
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
                    type: 'unknown_issue',
                    details: `Database check failed: ${(error as Error).message}`
                }],
                summary,
                reportPath: undefined
            };
        }
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
        taskFileMapping: Record<string, { filePath: string; lineNumber: number; status?: string; syncEnabled?: boolean }>
    ): Promise<{ 
        issues: DatabaseCheckIssue[], 
        summary: DatabaseCheckResult['summary'],
        vaultWithMappingCount: number,
        vaultWithoutMappingCount: number,
        orphanMappingCount: number,
        unknownIssueCount: number
    }> {
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
            taskNonActive: 0,
            taskIssue: 0,
            unknownIssue: 0,
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

        // ====== 第一步：Vault vs Mapping 对比（4 种组合）======
        
        // 收集所有任务 ID（只从 Vault 和 Mapping）
        const allTaskIds = new Set<string>();
        for (const taskId of vaultTasksMap.keys()) allTaskIds.add(taskId);
        for (const taskId of Object.keys(taskFileMapping)) allTaskIds.add(taskId);

        // 第一步统计
        let vaultWithMapping = 0;
        let vaultWithoutMapping = 0;
        let orphanMapping = 0;
        let unknownIssue = 0;

        for (const taskId of allTaskIds) {
            const vaultTask = vaultTasksMap.get(taskId);
            const mapping = taskFileMapping[taskId];
            
            const inVault = !!vaultTask;
            const inMapping = !!mapping;

            // 组合 1: Vault ✅ + Mapping ✅ → 进入第二步与 Todoist 对比
            if (inVault && inMapping) {
                vaultWithMapping++;
                const todoistTask = todoistTasksMap.get(taskId);
                const inTodoist = !!todoistTask;

                if (inTodoist) {
                    // 情况 1: Vault ✅ + Mapping ✅ + Todoist ✅ → 检查一致性
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
                    const todoistChecked = !!(todoistTask as any).checked;
                    if (vaultTask!.isCompleted !== todoistChecked) {
                        issues.push({
                            type: 'status_mismatch',
                            filePath: vaultTask!.filePath,
                            taskId,
                            lineNumber: vaultTask!.lineNumber,
                            details: `Status mismatch: Vault is ${vaultTask!.isCompleted ? 'completed' : 'incomplete'}, Todoist is ${todoistChecked ? 'completed' : 'incomplete'}`,
                            obsidianStatus: vaultTask!.isCompleted,
                            todoistStatus: todoistChecked
                        });
                        summary.statusMismatch++;
                    }

                    // ---- 检查优先级一致性 ----
                    // Priority is stored as !!<n> in task text, not as labels
                    // Skip priority check here — vault scan doesn't extract priority from text
                    const vaultPriority = todoistTask!.priority;
                    // Priority check disabled: vault scan doesn't extract priority from text
                    // if (vaultPriority !== todoistTask!.priority) {
                    //     issues.push({
                    //         type: 'priority_mismatch',
                    //         filePath: vaultTask!.filePath,
                    //         taskId,
                    //         lineNumber: vaultTask!.lineNumber,
                    //         details: `Priority mismatch: Vault is ${vaultPriority}, Todoist is ${todoistTask!.priority}`,
                    //         obsidianPriority: vaultPriority,
                    //         todoistPriority: todoistTask!.priority
                    //     });
                    //     summary.priorityMismatch++;
                    // }

                    // ---- 检查标签一致性 ----
                    // vaultTask.labels 现在已经不带 # 前缀（由 fileOperation.extractLabelsFromLine 处理）
                    const obsidianLabels = (vaultTask!.labels || []).filter(l => l !== 'todoist');
                    const todoistLabels = (todoistTask!.labels || []).filter(l => l !== 'todoist');
                    const labelDiff = obsidianLabels.filter(l => !todoistLabels.includes(l)).length > 0 ||
                                     todoistLabels.filter(l => !obsidianLabels.includes(l)).length > 0;
                    if (labelDiff) {
                        issues.push({
                            type: 'label_mismatch',
                            filePath: vaultTask!.filePath,
                            taskId,
                            lineNumber: vaultTask!.lineNumber,
                            details: `Labels differ: Vault [#${obsidianLabels.join(', #')}], Todoist [#${todoistLabels.join(', #')}]`,
                            obsidianLabels,
                            todoistLabels
                        });
                        summary.labelMismatch++;
                    }

                    // ---- 检查项目一致性 ----
                    if (mapping && vaultTask!.filePath) {
                        const fileMetadata = this.plugin.settings.fileMetadata?.[vaultTask!.filePath];
                        const mappingProjectId = fileMetadata?.defaultProjectId;
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
                            summary.projectMismatch++;
                        }
                    }
                } else {
                    // 情况 2: Vault ✅ + Mapping ✅ + Todoist ❌
                    // 检查 mapping.status → nonActive / issue / deleted
                    const mappingStatus = mapping.status;
                    if (mappingStatus === 'nonActive') {
                        issues.push({
                            type: 'task_nonactive',
                            filePath: vaultTask!.filePath,
                            taskId,
                            lineNumber: vaultTask!.lineNumber,
                            details: `Task marked as nonActive (completed in Vault, not in Todoist)`,
                            obsidianContent: vaultTask!.content,
                            obsidianStatus: vaultTask!.isCompleted
                        });
                        summary.taskNonActive++;
                    } else if (mappingStatus === 'issue') {
                        issues.push({
                            type: 'task_issue',
                            filePath: vaultTask!.filePath,
                            taskId,
                            lineNumber: vaultTask!.lineNumber,
                            details: `Task marked as issue (incomplete in Vault, not in Todoist)`,
                            obsidianContent: vaultTask!.content,
                            obsidianStatus: vaultTask!.isCompleted
                        });
                        summary.taskIssue++;
                    } else {
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
                }
            }
            // 组合 2: Vault ✅ + Mapping ❌ → 进入第二步与 Todoist 对比
            else if (inVault && !inMapping) {
                vaultWithoutMapping++;
                const todoistTask = todoistTasksMap.get(taskId);
                const inTodoist = !!todoistTask;

                if (inTodoist) {
                    // 情况 3: Vault ✅ + Mapping ❌ + Todoist ✅ → 需要重建 mapping
                    issues.push({
                        type: 'vault_task_no_mapping',
                        filePath: vaultTask!.filePath,
                        taskId,
                        lineNumber: vaultTask!.lineNumber,
                        details: `Task exists in Vault and Todoist but no mapping in settings (needs rebuild)`,
                        obsidianContent: vaultTask!.content,
                        todoistContent: todoistTask!.content,
                        obsidianStatus: vaultTask!.isCompleted,
                        todoistStatus: !!(todoistTask as any).checked
                    });
                    summary.vaultTaskNoMapping++;
                } else {
                    // 情况 4: Vault ✅ + Mapping ❌ + Todoist ❌ → Unknown issue
                    issues.push({
                        type: 'unknown_issue',
                        filePath: vaultTask!.filePath,
                        taskId,
                        lineNumber: vaultTask!.lineNumber,
                        details: `Task exists in Vault but not in mapping or Todoist (unknown issue)`,
                        obsidianContent: vaultTask!.content,
                        obsidianStatus: vaultTask!.isCompleted
                    });
                    summary.unknownIssue++;
                }
            }
            // 组合 3: Vault ❌ + Mapping ✅ → 无论文件是否存在，逻辑相同
            else if (!inVault && inMapping) {
                orphanMapping++;
                const todoistTask = todoistTasksMap.get(taskId);
                if (todoistTask) {
                    issues.push({
                        type: 'task_not_in_vault',
                        filePath: mapping.filePath,
                        taskId,
                        lineNumber: mapping.lineNumber,
                        details: `Task exists in Todoist and mapping but not found in Vault`,
                        todoistContent: todoistTask!.content,
                        todoistStatus: !!(todoistTask as any).checked
                    });
                    summary.taskNotInVault++;
                } else {
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
            }
            // 组合 4: Vault ❌ + Mapping ❌ → 理论上不应该发生
            else {
                unknownIssue++;
                summary.unknownIssue++;
            }
        }

        // ====== 第二步：处理只在 Todoist 中存在的任务 ======
        // 情况 7: Vault ❌ + Mapping ❌ + Todoist ✅ → 其他设备添加的任务（正常）
        for (const taskId of todoistTasksMap.keys()) {
            if (!vaultTasksMap.has(taskId) && !taskFileMapping[taskId]) {
                // 这是正常情况 - 任务是从其他设备添加的，不记录为问题
            }
        }

        // 返回问题和统计摘要，以及第一步 Vault vs Mapping 的组合统计
        return { 
            issues, 
            summary,
            // 第一步 Vault vs Mapping 的组合统计
            vaultWithMappingCount: vaultWithMapping,
            vaultWithoutMappingCount: vaultWithoutMapping,
            orphanMappingCount: orphanMapping,
            unknownIssueCount: unknownIssue
        };
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

        // 从 result 中获取第一步 Vault vs Mapping 组合统计
        const step1 = result.step1Stats || {
            vaultWithMapping: 0,
            vaultWithoutMapping: 0,
            orphanMapping: 0,
            unknownIssue: 0
        };

        // 从 summary 中提取第二步 8 种情况的统计
        const taskDeletedInTodoist = result.summary.taskDeletedInTodoist;
        const taskNonActive = result.summary.taskNonActive;
        const taskIssue = result.summary.taskIssue;
        const taskNotInVault = result.summary.taskNotInVault;
        const mappingOrphan = result.summary.mappingOrphan;

        // 使用第一步的统计
        const sumVaultWithMapping = step1.vaultWithMapping;
        const sumVaultWithoutMapping = step1.vaultWithoutMapping;
        const sumOrphanMapping = step1.orphanMapping;
        const sumUnknownIssue = step1.unknownIssue;
        const totalVaultMapping = sumVaultWithMapping + sumVaultWithoutMapping + sumOrphanMapping + sumUnknownIssue;

        // 计算第二步 8 种情况的统计
        // 情况 1: Vault ✅ + Mapping ✅ + Todoist ✅ = 全部 Vault+Mapping 任务 - 有问题的任务
        const totalVaultWithMappingTasks = step1.vaultWithMapping;
        const issuesInVaultWithMapping = result.summary.contentMismatch + result.summary.statusMismatch + 
            result.summary.priorityMismatch + result.summary.labelMismatch + 
            result.summary.projectMismatch + result.summary.lineNumberMismatch;
        const c1 = totalVaultWithMappingTasks - issuesInVaultWithMapping; // 一致的任务
        
        const c2 = taskDeletedInTodoist + taskNonActive + taskIssue; // Vault ✅ + Mapping ✅ + Todoist ❌
        const c3 = sumVaultWithoutMapping; // Vault ✅ + Mapping ❌ + Todoist ✅
        const c4 = sumUnknownIssue; // Vault ✅ + Mapping ❌ + Todoist ❌
        const c5 = taskNotInVault; // Vault ❌ + Mapping ✅ + Todoist ✅
        const c6 = mappingOrphan; // Vault ❌ + Mapping ✅ + Todoist ❌
        const c7 = 0; // Vault ❌ + Mapping ❌ + Todoist ✅
        const c8 = 0; // Vault ❌ + Mapping ❌ + Todoist ❌

        // 计算横向和纵向总计
        const totalVaultYes = c1 + c2 + c3 + c4;
        const totalVaultNo = c5 + c6 + c7 + c8;
        const totalMappingYes = c1 + c2 + c5 + c6;
        const totalMappingNo = c3 + c4 + c7 + c8;
        const totalTodoistYes = c1 + c3 + c5 + c7;
        const totalTodoistNo = c2 + c4 + c6 + c8;
        const grandTotal = c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8;

        // 生成 Markdown 报告内容
        let markdown = `# Database Check Report

Generated: ${new Date().toLocaleString()}

## Summary

| Status | Total Issues |
|--------|--------------|
| ${result.success ? '✅ Passed' : '❌ Issues Found'} | ${result.totalIssues} |

---

## Vault vs Mapping Summary

| Combination | Vault | Mapping | Count | Description |
|------------|-------|---------|-------|-------------|
| Normal | ✅ | ✅ | ${sumVaultWithMapping} | Check consistency with Todoist |
| Need Rebuild | ✅ | ❌ | ${sumVaultWithoutMapping} | Need rebuild mapping |
| Orphan Mapping | ❌ | ✅ | ${sumOrphanMapping} | File missing or task deleted |
| Unknown | ❌ | ❌ | ${sumUnknownIssue} | Unknown issue |
| **Total** | | | **${totalVaultMapping}** | |

---

## 8 Cases Detail

| # | Vault | Mapping | Todoist | Count | Description |
|---|-------|---------|---------|-------|-------------|
| 1 | ✅ | ✅ | ✅ | ${c1} | Consistency check |
| 2 | ✅ | ✅ | ❌ | ${c2} | nonActive / issue / deleted |
| 3 | ✅ | ❌ | ✅ | ${c3} | Need rebuild mapping |
| 4 | ✅ | ❌ | ❌ | ${c4} | Unknown issue |
| 5 | ❌ | ✅ | ✅ | ${c5} | File missing |
| 6 | ❌ | ✅ | ❌ | ${c6} | Orphan mapping |
| 7 | ❌ | ❌ | ✅ | ${c7} | Other device added (normal) |
| 8 | ❌ | ❌ | ❌ | ${c8} | Impossible |
| **Total** | | | | **${grandTotal}** | |

### Cross Totals

| | Vault ✅ | Vault ❌ | Total |
|---|---------|---------|-------|
| Mapping ✅ | ${c1 + c2} | ${c5 + c6} | ${totalMappingYes} |
| Mapping ❌ | ${c3 + c4} | ${c7 + c8} | ${totalMappingNo} |
| **Total** | ${totalVaultYes} | ${totalVaultNo} | **${grandTotal}** |

| | Todoist ✅ | Todoist ❌ | Total |
|---|---------|---------|-------|
| Vault ✅ | ${c1 + c3} | ${c2 + c4} | ${totalVaultYes} |
| Vault ❌ | ${c5 + c7} | ${c6 + c8} | ${totalVaultNo} |
| **Total** | ${totalTodoistYes} | ${totalTodoistNo} | **${grandTotal}** |

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
                'mapping_orphan': 'Orphan Mapping',
                'vault_task_no_mapping': 'Need Rebuild Mapping',
                'task_deleted_in_todoist': 'Task Deleted in Todoist',
                'task_nonactive': 'NonActive Task',
                'task_issue': 'Issue Task',
                'unknown_issue': 'Unknown Issue',
                'task_not_in_vault': 'File Missing',
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
                    // 生成 Obsidian wiki link，显示文件名但链接到完整路径
                    const fileBaseName = issue.filePath ? (issue.filePath.split('/').pop()?.replace(/\.md$/, '') || issue.filePath) : null;
                    const filePath = issue.filePath
                        ? `[[${issue.filePath.replace(/\.md$/, '')}|${fileBaseName}]]`
                        : '-';
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
            const reportsDir = this.plugin.storagePathManager?.getReportsPath() 
                || `${this.plugin.settings.storageDirectory}/reports`;
            await this.plugin.storagePathManager?.ensureDir(reportsDir);
            
            const reportPath = `${reportsDir}/${reportFilename}`;
            await this.app.vault.adapter.write(reportPath, markdown);

            this.plugin.logOperation?.log('DATABASE_CHECK', `Report saved to ${reportPath}`);
            return reportPath;
        } catch (error) {
            console.error('Failed to save report:', error);
            this.plugin.logOperation?.log('DATABASE_CHECK', `Failed to save report: ${(error as Error).message}`);
            return undefined;
        }
    }
}
