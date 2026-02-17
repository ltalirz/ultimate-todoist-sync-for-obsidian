import { App } from 'obsidian';
import UltimateTodoistSyncForObsidian from '../main';

export interface DatabaseCheckIssue {
    type: 
        // taskFileMapping 相关问题
        | 'mapping_file_not_found'    // taskFileMapping 中的文件不存在
        | 'mapping_task_not_in_todoist'  // taskFileMapping 中的 taskId 在 Todoist 不存在
        | 'mapping_orphan'           // taskFileMapping 孤岛 (Todoist和Vault都没有)
        | 'vault_task_no_mapping'    // Vault 有任务但 taskFileMapping 没有
        // 数据一致性问题
        | 'task_deleted_in_todoist'  // Vault+Mapping 有，但 Todoist 没有
        | 'task_not_in_vault'        // Todoist 有，但 Vault 没有对应文件
        | 'new_task_not_synced'      // Vault 有但 Todoist 没有 (新任务)
        | 'content_mismatch'         // 内容不一致
        | 'status_mismatch'          // 完成状态不一致
        | 'priority_mismatch'        // 优先级不一致
        | 'label_mismatch'          // 标签不一致
        | 'project_mismatch'         // 项目不一致
        | 'line_number_mismatch'     // 行号不一致
        | 'duplicate_task';          // 重复任务
    filePath?: string;
    taskId?: string;
    details: string;
    taskContent?: string;
    obsidianContent?: string;
    todoistContent?: string;
    obsidianStatus?: boolean;
    todoistStatus?: boolean;
    dueDate?: string;
    priority?: number;
    obsidianPriority?: number;
    todoistPriority?: number;
    projectId?: string;
    obsidianProjectId?: string;
    todoistProjectId?: string;
    projectName?: string;
    lineNumber?: number;
    obsidianLineNumber?: number;
    mappingLineNumber?: number;
    labels?: string[];
    obsidianLabels?: string[];
    todoistLabels?: string[];
}

export interface VaultTask {
    taskId: string;
    content: string;
    isCompleted: boolean;
    filePath: string;
    lineNumber: number;
    labels: string[];
}

export interface CacheTask {
    taskId: string;
    content: string;
    isCompleted: boolean;
    path: string;
    dueDate?: string;
    priority: number;
    projectId: string;
    labels: string[];
}

export interface TodoistTask {
    taskId: string;
    content: string;
    isCompleted: boolean;
    dueDate?: string;
    priority: number;
    projectId: string;
    labels: string[];
}

export interface DatabaseCheckResult {
    success: boolean;
    totalIssues: number;
    issues: DatabaseCheckIssue[];
    summary: {
        // taskFileMapping 相关
        mappingFileNotFound: number;
        mappingTaskNotInTodoist: number;
        mappingOrphan: number;
        vaultTaskNoMapping: number;
        // 数据一致性
        taskDeletedInTodoist: number;
        taskNotInVault: number;
        newTaskNotSynced: number;
        contentMismatch: number;
        statusMismatch: number;
        priorityMismatch: number;
        labelMismatch: number;
        projectMismatch: number;
        lineNumberMismatch: number;
        duplicateTask: number;
    };
    reportPath?: string;
}

export class DatabaseChecker {
    app: App;
    plugin: UltimateTodoistSyncForObsidian;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    async checkDatabase(noticeCallback?: (message: string) => void): Promise<DatabaseCheckResult> {
        const issues: DatabaseCheckIssue[] = [];
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

        if (noticeCallback) {
            noticeCallback('Starting data consistency check...');
        }

        try {
            // Step 1: Scan Vault tasks
            if (noticeCallback) {
                noticeCallback('Step 1/4: Scanning vault files...');
            }
            const vaultTasksMap = await this.scanVaultTasks();

            // Step 2: Get Todoist tasks from syncData
            if (noticeCallback) {
                noticeCallback('Step 2/4: Loading Todoist data from syncData...');
            }
            let syncData = this.plugin.todoistSyncAPI.getSyncData();
            if (!syncData) {
                await this.plugin.todoistSyncAPI.initializeSync();
                syncData = this.plugin.todoistSyncAPI.getSyncData();
            }
            const todoistTasksMap = this.getTodoistTasksFromSyncData(syncData);

            // Step 3: Get taskFileMapping
            if (noticeCallback) {
                noticeCallback('Step 3/4: Loading taskFileMapping...');
            }
            const taskFileMapping = this.plugin.settings.taskFileMapping || {};

            // Step 4: Analyze differences
            if (noticeCallback) {
                noticeCallback('Step 4/4: Analyzing differences...');
            }

            const result = this.compareThreeSources(
                vaultTasksMap,
                todoistTasksMap,
                taskFileMapping
            );
            issues.push(...result.issues);
            Object.assign(summary, result.summary);

            const totalIssues = Object.values(summary).reduce((a, b) => a + b, 0);
            this.plugin.logOperation?.log('DATABASE_CHECKED', `Database check completed: ${totalIssues} issues found`);

            const reportPath = await this.generateReport({
                success: totalIssues === 0,
                totalIssues,
                issues,
                summary
            });

            return {
                success: totalIssues === 0,
                totalIssues,
                issues,
                summary,
                reportPath
            };
        } catch (error) {
            this.plugin.logOperation?.log('DATABASE_CHECK', `Database check failed: ${(error as Error).message}`);
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

    async scanVaultTasks(): Promise<Map<string, VaultTask>> {
        const vaultTasksMap = new Map<string, VaultTask>();
        const files = this.app.vault.getFiles().filter(f => f.extension === 'md');

        for (const file of files) {
            try {
                const content = await this.app.vault.cachedRead(file);
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.includes('#todoist')) {
                        const match = line.match(/%%\[todoist_id::\s*([\w-]+)\]%%/);
                        if (match && match[1]) {
                            const taskId = match[1];
                            const taskContent = this.extractTaskContent(line);
                            const isCompleted = /\[x\]/i.test(line);
                            const labels = this.extractLabelsFromLine(line);

                            if (vaultTasksMap.has(taskId)) {
                                continue;
                            }

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
                console.error(`Error reading file ${file.path}:`, error);
            }
        }

        return vaultTasksMap;
    }

    loadCacheTasks(): Map<string, CacheTask> {
        const cacheTasksMap = new Map<string, CacheTask>();
        
        // Ensure syncData is loaded
        let syncData = this.plugin.todoistSyncAPI.getSyncData();
        if (!syncData) {
            console.warn('[DatabaseChecker] syncData not loaded, attempting to load...');
            // Can't await here, return empty map
            return cacheTasksMap;
        }
        
        const taskFileMapping = this.plugin.settings.taskFileMapping || {};
        const items = syncData.items || [];
        
        for (const task of items) {
            if (!task) continue;
            const mapping = taskFileMapping[task.id];
            if (!mapping) continue;
            cacheTasksMap.set(task.id, {
                taskId: task.id,
                content: task.content,
                isCompleted: task.isCompleted || false,
                path: mapping.filePath,
                dueDate: task.due?.date,
                priority: task.priority || 4,
                projectId: task.projectId || '',
                labels: task.labels || []
            });
        }

        return cacheTasksMap;
    }

    async fetchTodoistTasks(): Promise<Map<string, TodoistTask>> {
        const todoistTasksMap = new Map<string, TodoistTask>();
        const todoistTasks = await this.plugin.todoistSyncAPI.GetActiveTasks({});
        
        if (!todoistTasks) {
            return todoistTasksMap;
        }
        
        for (const task of todoistTasks) {
            if (!task) continue;
            const taskAny = task as any;
            todoistTasksMap.set(task.id, {
                taskId: task.id,
                content: task.content || '',
                isCompleted: taskAny.isCompleted || taskAny.completedAt !== null || false,
                dueDate: task.due?.date,
                priority: task.priority || 4,
                projectId: task.projectId || '',
                labels: []
            });
        }

        return todoistTasksMap;
    }

    getTodoistTasksFromSyncData(syncData: Record<string, any> | null): Map<string, TodoistTask> {
        const todoistTasksMap = new Map<string, TodoistTask>();
        if (!syncData || !syncData.items) {
            return todoistTasksMap;
        }
        
        for (const task of syncData.items) {
            if (!task) continue;
            const taskAny = task as any;
            todoistTasksMap.set(task.id, {
                taskId: task.id,
                content: task.content || '',
                isCompleted: taskAny.isCompleted || taskAny.completedAt !== null || false,
                dueDate: task.due?.date,
                priority: task.priority || 4,
                projectId: task.projectId || '',
                labels: task.labels || []
            });
        }

        return todoistTasksMap;
    }

    compareThreeSources(
        vaultTasksMap: Map<string, VaultTask>,
        todoistTasksMap: Map<string, TodoistTask>,
        taskFileMapping: Record<string, { filePath: string; lineNumber: number }>
    ): { issues: DatabaseCheckIssue[], summary: DatabaseCheckResult['summary'] } {
        const issues: DatabaseCheckIssue[] = [];
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

        // Get all files in vault for path validation
        const vaultFiles = new Set(this.app.vault.getFiles().map(f => f.path));

        // Check taskFileMapping validity
        for (const [taskId, mapping] of Object.entries(taskFileMapping)) {
            // Check if file exists
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

            // Check if task exists in Todoist
            if (!todoistTasksMap.has(taskId)) {
                issues.push({
                    type: 'mapping_task_not_in_todoist',
                    filePath: mapping.filePath,
                    taskId,
                    lineNumber: mapping.lineNumber,
                    details: `Mapping task "${taskId}" does not exist in Todoist (deleted in Todoist)`
                });
                summary.mappingTaskNotInTodoist++;
            }
        }

        // Collect all task IDs
        const allTaskIds = new Set<string>();
        for (const taskId of vaultTasksMap.keys()) allTaskIds.add(taskId);
        for (const taskId of todoistTasksMap.keys()) allTaskIds.add(taskId);
        for (const taskId of Object.keys(taskFileMapping)) allTaskIds.add(taskId);

        for (const taskId of allTaskIds) {
            const vaultTask = vaultTasksMap.get(taskId);
            const todoistTask = todoistTasksMap.get(taskId);
            const mapping = taskFileMapping[taskId];

            const inVault = !!vaultTask;
            const inTodoist = !!todoistTask;
            const inMapping = !!mapping;

            // ============ 8 种组合情况 ============

            // 情况2: Vault ✓ + Todoist ✓ + Mapping ✗
            // settings丢失，需要重建mapping
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
                    todoistStatus: todoistTask!.isCompleted
                });
                summary.vaultTaskNoMapping++;
            }

            // 情况3: Vault ✓ + Todoist ✗ + Mapping ✓
            // Todoist端删除任务
            else if (inVault && !inTodoist && inMapping) {
                issues.push({
                    type: 'task_deleted_in_todoist',
                    filePath: vaultTask!.filePath,
                    taskId,
                    lineNumber: vaultTask!.lineNumber,
                    details: `Task exists in Vault and mapping but was deleted in Todoist`,
                    obsidianContent: vaultTask!.content,
                    obsidianStatus: vaultTask!.isCompleted
                });
                summary.taskDeletedInTodoist++;
            }

            // 情况4: Vault ✓ + Todoist ✗ + Mapping ✗
            // 新任务未同步
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

            // 情况5: Vault ✗ + Todoist ✓ + Mapping ✓
            // Vault文件丢失
            else if (!inVault && inTodoist && inMapping) {
                issues.push({
                    type: 'task_not_in_vault',
                    filePath: mapping.filePath,
                    taskId,
                    lineNumber: mapping.lineNumber,
                    details: `Task exists in Todoist and mapping but Vault file is missing (file deleted or moved)`,
                    todoistContent: todoistTask!.content,
                    todoistStatus: todoistTask!.isCompleted
                });
                summary.taskNotInVault++;
            }

            // 情况6: Vault ✗ + Todoist ✓ + Mapping ✗
            // 其他设备添加的任务
            else if (!inVault && inTodoist && !inMapping) {
                // This is normal - task was added from another device
                // No issue, just informational
            }

            // 情况7: Vault ✗ + Todoist ✗ + Mapping ✓
            // mapping孤岛
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

            // 情况1: Vault ✓ + Todoist ✓ + Mapping ✓
            // 全部正常，检查数据一致性
            else if (inVault && inTodoist && inMapping) {
                // Check line number
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

                // Check content
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

                // Check status
                if (vaultTask!.isCompleted !== todoistTask!.isCompleted) {
                    issues.push({
                        type: 'status_mismatch',
                        filePath: vaultTask!.filePath,
                        taskId,
                        lineNumber: vaultTask!.lineNumber,
                        details: `Status mismatch: Vault is ${vaultTask!.isCompleted ? 'completed' : 'incomplete'}, Todoist is ${todoistTask!.isCompleted ? 'completed' : 'incomplete'}`,
                        obsidianStatus: vaultTask!.isCompleted,
                        todoistStatus: todoistTask!.isCompleted
                    });
                    summary.statusMismatch++;
                }

                // Check priority
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
                    summary.priorityMismatch++;
                }

                // Check labels
                const obsidianLabels = vaultTask!.labels || [];
                const todoistLabels = todoistTask!.labels || [];
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
                    summary.labelMismatch++;
                }

                // Check project (optional - might not be needed if using default project)
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
            }
        }

        return { issues, summary };
    }

    private extractTaskContent(line: string): string {
        let content = line.replace(/^(\s*)([-*])\s+\[(x|X| )\]\s*/, '');
        content = content.replace(/#todoist/g, '').trim();
        content = content.replace(/%%\[todoist_id::\s*[\w-]+\]%%/g, '').trim();
        content = content.replace(/\[link\]\([^)]+\)/g, '').trim();
        content = content.replace(/[🗓️📅📆🗓]\s*\d{4}-\d{2}-\d{2}/gu, '').trim();
        content = content.replace(/\s!![1-4]\s/g, ' ').trim();
        return content;
    }

    private extractLabelsFromLine(line: string): string[] {
        const labels: string[] = [];
        const labelRegex = /#(\w+)/g;
        let match;
        while ((match = labelRegex.exec(line)) !== null) {
            if (match[1] !== 'todoist') {
                labels.push(match[1]);
            }
        }
        return labels;
    }

    async generateReport(result: DatabaseCheckResult): Promise<string | undefined> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportFilename = `database-check-${timestamp}.md`;
        const reportFolder = '.todoist-reports';

        let markdown = `# Database Check Report

Generated: ${new Date().toLocaleString()}

## Summary

| Status | Count |
|--------|-------|
| ${result.success ? '✅ Passed' : '❌ Issues Found'} | ${result.totalIssues} |

### Issue Breakdown

| Issue Type | Count |
|------------|-------|
| Mapping File Not Found | ${result.summary.mappingFileNotFound} |
| Mapping Task Not in Todoist | ${result.summary.mappingTaskNotInTodoist} |
| Mapping Orphan | ${result.summary.mappingOrphan} |
| Vault Task No Mapping | ${result.summary.vaultTaskNoMapping} |
| Task Deleted in Todoist | ${result.summary.taskDeletedInTodoist} |
| Task Not in Vault | ${result.summary.taskNotInVault} |
| New Task Not Synced | ${result.summary.newTaskNotSynced} |
| Content Mismatch | ${result.summary.contentMismatch} |
| Status Mismatch | ${result.summary.statusMismatch} |
| Priority Mismatch | ${result.summary.priorityMismatch} |
| Label Mismatch | ${result.summary.labelMismatch} |
| Project Mismatch | ${result.summary.projectMismatch} |
| Line Number Mismatch | ${result.summary.lineNumberMismatch} |
| Duplicate Task | ${result.summary.duplicateTask} |

---

## Detailed Issues

`;
        if (result.issues.length === 0) {
            markdown += '*No issues found. Database is healthy.*\n';
        } else {
            const groupedByType = new Map<string, DatabaseCheckIssue[]>();
            for (const issue of result.issues) {
                if (!groupedByType.has(issue.type)) {
                    groupedByType.set(issue.type, []);
                }
                groupedByType.get(issue.type)!.push(issue);
            }

            const typeLabels: Record<string, string> = {
                'mapping_file_not_found': 'Mapping File Not Found',
                'mapping_task_not_in_todoist': 'Mapping Task Not in Todoist',
                'mapping_orphan': 'Mapping Orphan',
                'vault_task_no_mapping': 'Vault Task No Mapping',
                'task_deleted_in_todoist': 'Task Deleted in Todoist',
                'task_not_in_vault': 'Task Not in Vault',
                'new_task_not_synced': 'New Task Not Synced',
                'content_mismatch': 'Content Mismatch (Vault vs Todoist)',
                'status_mismatch': 'Status Mismatch (Vault vs Todoist)',
                'priority_mismatch': 'Priority Mismatch',
                'label_mismatch': 'Label Mismatch',
                'project_mismatch': 'Project Mismatch',
                'line_number_mismatch': 'Line Number Mismatch',
                'duplicate_task': 'Duplicate Task'
            };

            const priorityLabels: Record<number, string> = {
                1: 'Low',
                2: 'Medium',
                3: 'High',
                4: 'Urgent'
            };

            for (const [type, issues] of groupedByType) {
                markdown += `### ${typeLabels[type] || type}\n\n`;
                markdown += `| # | Task ID | Content | File | Line | Due Date | Priority | Status | Details |\n`;
                markdown += `|---|---------|---------|------|------|----------|----------|--------|--------|\n`;
                
                for (let i = 0; i < issues.length; i++) {
                    const issue = issues[i];
                    const taskContent = issue.taskContent?.substring(0, 40) || issue.obsidianContent?.substring(0, 40) || '-';
                    const filePath = issue.filePath || '-';
                    const lineNum = issue.lineNumber !== undefined ? String(issue.lineNumber + 1) : '-';
                    const dueDate = issue.dueDate || '-';
                    const priority = issue.priority ? priorityLabels[issue.priority] || String(issue.priority) : '-';
                    
                    let status = '-';
                    if (issue.obsidianStatus !== undefined || issue.todoistStatus !== undefined) {
                        const obs = issue.obsidianStatus ? '✅' : '⬜';
                        const todo = issue.todoistStatus ? '✅' : '⬜';
                        status = `Obs:${obs} Todo:${todo}`;
                    }

                    const details = issue.details.substring(0, 60);
                    
                    markdown += `| ${i + 1} | \`${issue.taskId || '-'}\` | ${taskContent} | ${filePath.split('/').pop() || '-'} | ${lineNum} | ${dueDate} | ${priority} | ${status} | ${details} |\n`;
                }
                markdown += '\n';

                if (type === 'content_mismatch') {
                    markdown += `#### Detailed Comparison\n\n`;
                    for (let i = 0; i < issues.length; i++) {
                        const issue = issues[i];
                        if (issue.obsidianContent || issue.todoistContent) {
                            markdown += `**Issue ${i + 1}:** \`${issue.taskId}\`\n`;
                            if (issue.obsidianContent) {
                                markdown += `- **Vault:** ${issue.obsidianContent}\n`;
                            }
                            if (issue.todoistContent) {
                                markdown += `- **Todoist:** ${issue.todoistContent}\n`;
                            }
                            markdown += '\n';
                        }
                    }
                }
            }
        }

        markdown += `---

## Statistics

- Total Issues Found: ${result.totalIssues}
- Mapping Related Issues: ${result.summary.mappingFileNotFound + result.summary.mappingTaskNotInTodoist + result.summary.mappingOrphan + result.summary.vaultTaskNoMapping}
- Data Consistency Issues: ${result.summary.contentMismatch + result.summary.statusMismatch + result.summary.priorityMismatch + result.summary.labelMismatch + result.summary.projectMismatch + result.summary.lineNumberMismatch}

---

*Report generated by Ultimate Todoist Sync for Obsidian*
`;

        try {
            // 直接尝试创建文件夹，忽略已存在的错误
            try {
                await this.app.vault.createFolder(reportFolder);
            } catch {
                // 文件夹已存在，忽略
            }

            const reportPath = `${reportFolder}/${reportFilename}`;
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
