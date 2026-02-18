import { App } from 'obsidian';
import UltimateTodoistSyncForObsidian from "../main";

export interface LogEntry {
    timestamp: number;
    action: LogAction;
    details: string;
    filePath?: string;
    taskId?: string;
}

export type LogAction = 
    // Task operations - User actions in Obsidian
    | 'OBSIDIAN_TASK_CREATED'
    | 'OBSIDIAN_TASK_MODIFIED'
    | 'OBSIDIAN_TASK_DELETED'
    | 'OBSIDIAN_TASK_COMPLETED'
    | 'OBSIDIAN_TASK_REOPENED'
    | 'OBSIDIAN_TASK_CONTENT_CHANGED'
    | 'OBSIDIAN_TASK_DUEDATE_CHANGED'
    | 'OBSIDIAN_TASK_PRIORITY_CHANGED'
    | 'OBSIDIAN_TASK_LABEL_CHANGED'
    // File operations
    | 'FILE_MODIFIED'
    | 'FILE_RENAMED'
    | 'FILE_TODOIST_TAG_ADDED'
    | 'FILE_TASK_COMPLETED'
    | 'FILE_TASK_UNCOMPLETED'
    | 'FILE_TASK_CONTENT_SYNCED'
    | 'FILE_TASK_DUEDATE_SYNCED'
    | 'FILE_TASK_NOTE_ADDED'
    // Cache operations
    | 'CACHE_TASK_ADDED'
    | 'CACHE_TASK_UPDATED'
    | 'CACHE_TASK_DELETED'
    | 'CACHE_TASK_NONACTIVE'
    | 'CACHE_TASK_CONFLICTED'
    | 'CACHE_TASK_ISSUE'
    | 'CACHE_TASK_NON_ID'
    | 'CACHE_TASK_COMPLETED'
    | 'CACHE_TASK_REOPENED'
    | 'CACHE_FILE_METADATA_UPDATED'
    | 'CACHE_FILE_METADATA_DELETED'
    | 'CACHE_RENAMED'
    | 'CACHE_REBUILT'
    | 'DATABASE_CHECK'
    | 'DATABASE_CHECKED'
    // Todoist API operations
    | 'TODOIST_TASK_CREATED'
    | 'TODOIST_TASK_UPDATED'
    | 'TODOIST_TASK_DELETED'
    | 'TODOIST_TASK_COMPLETED'
    | 'TODOIST_TASK_REOPENED'
    // Sync operations
    | 'SYNC_START'
    | 'SYNC_COMPLETED'
    | 'SYNC_ERROR'
    | 'BACKUP_CREATED'
    | 'PROJECT_UPDATED'
    | 'PLUGIN_INITIALIZED'
    | 'SETTINGS_UPDATED';

export class LogOperation {
    app: App;
    plugin: UltimateTodoistSyncForObsidian;
    private maxLogs: number = 500;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    log(action: LogAction, details: string, filePath?: string, taskId?: string): void {
        if (!this.plugin.settings.enableLog) {
            return;
        }

        const logEntry: LogEntry = {
            timestamp: Date.now(),
            action,
            details,
            filePath,
            taskId
        };

        this.plugin.settings.logs.push(logEntry);

        if (this.plugin.settings.logs.length > this.maxLogs) {
            this.plugin.settings.logs = this.plugin.settings.logs.slice(-this.maxLogs);
        }

        if (this.plugin.settings.debugMode) {
            console.log(`[Log] ${action}: ${details}`, { filePath, taskId });
        }
    }

    getLogs(): LogEntry[] {
        return this.plugin.settings.logs || [];
    }

    getLogsAsText(): string {
        const logs = this.getLogs();
        if (logs.length === 0) {
            return 'No logs available.';
        }

        return logs.map(log => {
            const date = new Date(log.timestamp).toLocaleString();
            const fileInfo = log.filePath ? ` [${log.filePath}]` : '';
            const taskInfo = log.taskId ? ` (task: ${log.taskId})` : '';
            return `[${date}] ${log.action}: ${log.details}${fileInfo}${taskInfo}`;
        }).join('\n');
    }

    clearLogs(): void {
        this.plugin.settings.logs = [];
        this.plugin.saveSettings();
    }

    exportLogs(): string {
        return this.getLogsAsText();
    }
}
