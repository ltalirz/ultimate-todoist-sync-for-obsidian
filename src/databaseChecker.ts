import { App } from 'obsidian';
import UltimateTodoistSyncForObsidian from '../main';

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
            taskDeletedInTodoist: 0,
            missingInCache: 0,
            newTaskNotSynced: 0,
            fileReferenceMissing: 0,
            orphanedInCache: 0,
            taskNotInVault: 0,
            contentMismatch: 0,
            cacheContentOutdated: 0,
            statusMismatch: 0,
            cacheStatusOutdated: 0,
            duedateMismatch: 0,
            duplicateTask: 0,
            priorityMismatch: 0,
            labelMismatch: 0,
            projectMismatch: 0,
            emptyMetadata: 0
        };

        if (noticeCallback) {
            noticeCallback('Starting 3-way data comparison...');
        }

        try {
            if (noticeCallback) {
                noticeCallback('Step 1/4: Scanning vault files...');
            }

            const vaultTasksMap = await this.scanVaultTasks();

            if (noticeCallback) {
                noticeCallback('Step 2/4: Loading local cache...');
            }

            const cacheTasksMap = this.loadCacheTasks();

            if (noticeCallback) {
                noticeCallback('Step 3/4: Fetching data from Todoist...');
            }

            const todoistTasksMap = await this.fetchTodoistTasks();

            if (noticeCallback) {
                noticeCallback('Step 4/4: Analyzing differences...');
            }

            const result = this.compareThreeWay(vaultTasksMap, cacheTasksMap, todoistTasksMap);
            issues.push(...result.issues);
            for (const key of Object.keys(summary) as (keyof typeof summary)[]) {
                (summary as any)[key] = (result.summary as any)[key];
            }

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

    compareThreeWay(
        vaultTasksMap: Map<string, VaultTask>,
        cacheTasksMap: Map<string, CacheTask>,
        todoistTasksMap: Map<string, TodoistTask>
    ): { issues: DatabaseCheckIssue[], summary: DatabaseCheckResult['summary'] } {
        const issues: DatabaseCheckIssue[] = [];
        const summary = {
            taskDeletedInTodoist: 0,
            missingInCache: 0,
            newTaskNotSynced: 0,
            fileReferenceMissing: 0,
            orphanedInCache: 0,
            taskNotInVault: 0,
            contentMismatch: 0,
            cacheContentOutdated: 0,
            statusMismatch: 0,
            cacheStatusOutdated: 0,
            duedateMismatch: 0,
            duplicateTask: 0,
            priorityMismatch: 0,
            labelMismatch: 0,
            projectMismatch: 0,
            emptyMetadata: 0
        };

        const allTaskIds = new Set<string>();
        for (const taskId of vaultTasksMap.keys()) allTaskIds.add(taskId);
        for (const taskId of cacheTasksMap.keys()) allTaskIds.add(taskId);
        for (const taskId of todoistTasksMap.keys()) allTaskIds.add(taskId);

        for (const taskId of allTaskIds) {
            const vaultTask = vaultTasksMap.get(taskId);
            const cacheTask = cacheTasksMap.get(taskId);
            const todoistTask = todoistTasksMap.get(taskId);

            const inVault = !!vaultTask;
            const inCache = !!cacheTask;
            const inTodoist = !!todoistTask;

            if (inVault && inCache && !inTodoist) {
                issues.push({
                    type: 'task_deleted_in_todoist',
                    filePath: vaultTask!.filePath,
                    taskId,
                    lineNumber: vaultTask!.lineNumber,
                    details: `Task "${cacheTask!.content}" exists in Vault and Cache but was deleted in Todoist`,
                    taskContent: cacheTask!.content,
                    obsidianContent: vaultTask!.content,
                    cacheContent: cacheTask!.content,
                    obsidianStatus: vaultTask!.isCompleted,
                    cacheStatus: cacheTask!.isCompleted
                });
                summary.taskDeletedInTodoist++;
            }
            else if (inVault && !inCache && inTodoist) {
                issues.push({
                    type: 'missing_in_cache',
                    filePath: vaultTask!.filePath,
                    taskId,
                    lineNumber: vaultTask!.lineNumber,
                    details: `Task "${todoistTask!.content}" exists in Vault and Todoist but not in local cache`,
                    taskContent: todoistTask!.content,
                    obsidianContent: vaultTask!.content,
                    obsidianStatus: vaultTask!.isCompleted,
                    dueDate: todoistTask!.dueDate,
                    cacheDueDate: undefined,
                    priority: todoistTask!.priority
                });
                summary.missingInCache++;
            }
            else if (inVault && !inCache && !inTodoist) {
                issues.push({
                    type: 'new_task_not_synced',
                    filePath: vaultTask!.filePath,
                    taskId,
                    lineNumber: vaultTask!.lineNumber,
                    details: `Task "${vaultTask!.content}" in Vault is not synced to Todoist and not in cache`,
                    taskContent: vaultTask!.content,
                    obsidianContent: vaultTask!.content,
                    obsidianStatus: vaultTask!.isCompleted
                });
                summary.newTaskNotSynced++;
            }
            else if (!inVault && inCache && inTodoist) {
                issues.push({
                    type: 'file_reference_missing',
                    taskId,
                    details: `Task "${todoistTask!.content}" exists in Cache and Todoist but Vault file reference is missing`,
                    taskContent: todoistTask!.content,
                    cacheContent: cacheTask!.content,
                    filePath: cacheTask!.path,
                    todoistContent: todoistTask!.content,
                    todoistStatus: todoistTask!.isCompleted,
                    cacheStatus: cacheTask!.isCompleted
                });
                summary.fileReferenceMissing++;
            }
            else if (!inVault && inCache && !inTodoist) {
                issues.push({
                    type: 'orphaned_in_cache',
                    taskId,
                    details: `Task "${cacheTask!.content}" exists in Cache but not in Vault and was deleted in Todoist`,
                    taskContent: cacheTask!.content,
                    cacheContent: cacheTask!.content,
                    filePath: cacheTask!.path,
                    cacheStatus: cacheTask!.isCompleted
                });
                summary.orphanedInCache++;
            }
            else if (!inVault && !inCache && inTodoist) {
                issues.push({
                    type: 'task_not_in_vault',
                    taskId,
                    details: `Task "${todoistTask!.content}" exists in Todoist but not in any Vault file`,
                    taskContent: todoistTask!.content,
                    todoistContent: todoistTask!.content,
                    todoistStatus: todoistTask!.isCompleted,
                    dueDate: todoistTask!.dueDate,
                    priority: todoistTask!.priority
                });
                summary.taskNotInVault++;
            }
            else if (inVault && inCache && inTodoist) {
                if (vaultTask!.content.trim() !== todoistTask!.content.trim()) {
                    issues.push({
                        type: 'content_mismatch',
                        filePath: vaultTask!.filePath,
                        taskId,
                        lineNumber: vaultTask!.lineNumber,
                        details: `Task content differs between Vault and Todoist`,
                        taskContent: todoistTask!.content,
                        obsidianContent: vaultTask!.content.substring(0, 100),
                        todoistContent: todoistTask!.content.substring(0, 100),
                        obsidianStatus: vaultTask!.isCompleted,
                        todoistStatus: todoistTask!.isCompleted,
                        dueDate: todoistTask!.dueDate
                    });
                    summary.contentMismatch++;
                }

                if (cacheTask!.content.trim() !== todoistTask!.content.trim()) {
                    issues.push({
                        type: 'cache_content_outdated',
                        filePath: cacheTask!.path,
                        taskId,
                        details: `Cache content is outdated compared to Todoist`,
                        taskContent: todoistTask!.content,
                        cacheContent: cacheTask!.content.substring(0, 100),
                        todoistContent: todoistTask!.content.substring(0, 100),
                        cacheStatus: cacheTask!.isCompleted,
                        todoistStatus: todoistTask!.isCompleted
                    });
                    summary.cacheContentOutdated++;
                }

                if (vaultTask!.isCompleted !== todoistTask!.isCompleted) {
                    issues.push({
                        type: 'status_mismatch',
                        filePath: vaultTask!.filePath,
                        taskId,
                        lineNumber: vaultTask!.lineNumber,
                        details: `Task completion status differs: Vault is ${vaultTask!.isCompleted ? 'completed' : 'incomplete'}, Todoist is ${todoistTask!.isCompleted ? 'completed' : 'incomplete'}`,
                        taskContent: todoistTask!.content,
                        obsidianStatus: vaultTask!.isCompleted,
                        todoistStatus: todoistTask!.isCompleted,
                        dueDate: todoistTask!.dueDate
                    });
                    summary.statusMismatch++;
                }

                if (cacheTask!.isCompleted !== todoistTask!.isCompleted) {
                    issues.push({
                        type: 'cache_status_outdated',
                        filePath: cacheTask!.path,
                        taskId,
                        details: `Cache status is outdated: Cache is ${cacheTask!.isCompleted ? 'completed' : 'incomplete'}, Todoist is ${todoistTask!.isCompleted ? 'completed' : 'incomplete'}`,
                        taskContent: todoistTask!.content,
                        cacheStatus: cacheTask!.isCompleted,
                        todoistStatus: todoistTask!.isCompleted
                    });
                    summary.cacheStatusOutdated++;
                }

                if (cacheTask!.dueDate !== todoistTask!.dueDate) {
                    issues.push({
                        type: 'duedate_mismatch',
                        filePath: cacheTask!.path,
                        taskId,
                        details: `Due date differs: Cache is "${cacheTask!.dueDate || 'none'}", Todoist is "${todoistTask!.dueDate || 'none'}"`,
                        taskContent: todoistTask!.content,
                        dueDate: todoistTask!.dueDate,
                        cacheDueDate: cacheTask!.dueDate
                    });
                    summary.duedateMismatch++;
                }

                if (cacheTask!.priority !== todoistTask!.priority) {
                    issues.push({
                        type: 'priority_mismatch',
                        filePath: cacheTask!.path,
                        taskId,
                        details: `Priority differs: Cache is ${cacheTask!.priority}, Todoist is ${todoistTask!.priority}`,
                        taskContent: todoistTask!.content,
                        priority: todoistTask!.priority,
                        cachePriority: cacheTask!.priority
                    });
                    summary.priorityMismatch++;
                }

                if (cacheTask!.projectId !== todoistTask!.projectId) {
                    let cacheProjectName: string | null | undefined;
                    let todoistProjectName: string | null | undefined;
                    const syncData = this.plugin.todoistSyncAPI.getSyncData();
                    if (syncData) {
                        const projects = syncData.projects || [];
                        cacheProjectName = projects.find((p: any) => p.id === cacheTask!.projectId)?.name;
                        todoistProjectName = projects.find((p: any) => p.id === todoistTask!.projectId)?.name;
                    }
                    issues.push({
                        type: 'project_mismatch',
                        filePath: cacheTask!.path,
                        taskId,
                        details: `Project differs: Cache is "${cacheProjectName || cacheTask!.projectId}", Todoist is "${todoistProjectName || todoistTask!.projectId}"`,
                        taskContent: todoistTask!.content,
                        projectId: todoistTask!.projectId,
                        cacheProjectId: cacheTask!.projectId
                    });
                    summary.projectMismatch++;
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
| Task Deleted in Todoist | ${result.summary.taskDeletedInTodoist} |
| Missing in Cache | ${result.summary.missingInCache} |
| New Task Not Synced | ${result.summary.newTaskNotSynced} |
| File Reference Missing | ${result.summary.fileReferenceMissing} |
| Orphaned in Cache | ${result.summary.orphanedInCache} |
| Task Not in Vault | ${result.summary.taskNotInVault} |
| Content Mismatch | ${result.summary.contentMismatch} |
| Cache Content Outdated | ${result.summary.cacheContentOutdated} |
| Status Mismatch | ${result.summary.statusMismatch} |
| Cache Status Outdated | ${result.summary.cacheStatusOutdated} |
| Due Date Mismatch | ${result.summary.duedateMismatch} |
| Duplicate Task | ${result.summary.duplicateTask} |
| Priority Mismatch | ${result.summary.priorityMismatch} |
| Label Mismatch | ${result.summary.labelMismatch} |
| Project Mismatch | ${result.summary.projectMismatch} |
| Empty Metadata | ${result.summary.emptyMetadata} |

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
                'task_deleted_in_todoist': 'Task Deleted in Todoist',
                'missing_in_cache': 'Missing in Cache',
                'new_task_not_synced': 'New Task Not Synced',
                'file_reference_missing': 'File Reference Missing',
                'orphaned_in_cache': 'Orphaned in Cache',
                'task_not_in_vault': 'Task Not in Vault',
                'content_mismatch': 'Content Mismatch (Vault vs Todoist)',
                'cache_content_outdated': 'Cache Content Outdated',
                'status_mismatch': 'Status Mismatch (Vault vs Todoist)',
                'cache_status_outdated': 'Cache Status Outdated',
                'duedate_mismatch': 'Due Date Mismatch',
                'duplicate_task': 'Duplicate Task',
                'priority_mismatch': 'Priority Mismatch',
                'label_mismatch': 'Label Mismatch',
                'project_mismatch': 'Project Mismatch',
                'empty_metadata': 'Empty Metadata'
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
                    const dueDate = issue.dueDate || issue.cacheDueDate || '-';
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

                if (type === 'content_mismatch' || type === 'cache_content_outdated') {
                    markdown += `#### Detailed Comparison\n\n`;
                    for (let i = 0; i < issues.length; i++) {
                        const issue = issues[i];
                        if (issue.obsidianContent || issue.todoistContent || issue.cacheContent) {
                            markdown += `**Issue ${i + 1}:** \`${issue.taskId}\`\n`;
                            if (issue.obsidianContent) {
                                markdown += `- **Vault:** ${issue.obsidianContent}\n`;
                            }
                            if (issue.cacheContent) {
                                markdown += `- **Cache:** ${issue.cacheContent}\n`;
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

- Total Vault Tasks: ${result.issues.filter(i => i.obsidianContent || i.filePath).length}
- Total Cache Tasks: ${result.issues.filter(i => i.cacheContent || i.cacheStatus !== undefined).length}
- Total Todoist Tasks: ${result.issues.filter(i => i.todoistContent || i.todoistStatus !== undefined).length}

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
