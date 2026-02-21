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
    private maxLogs = 500;
    private currentDate = '';
    private todayLogs: LogEntry[] = [];
    private lastCleanupDate = '';
    private logBuffer: LogEntry[] = [];
    private readonly BATCH_SIZE = 20;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
        this.initializeLogs();
    }

    private initializeLogs(): void {
        const today = this.getTodayDateString();
        this.currentDate = today;
        this.lastCleanupDate = today;
        
        if (this.plugin.settings.logFileEnabled) {
            this.migrateLegacyLogs();
        }
        
        this.todayLogs = [];
        
        if (this.plugin.settings.debugMode) {
            console.log(`[LogOperation] Initialized with empty today's logs (stored in JSON files)`);
        }
    }

    private getTodayDateString(): string {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    private migrateLegacyLogs(): void {
        const legacyLogs = this.plugin.settings.logs;
        if (legacyLogs && legacyLogs.length > 0) {
            if (this.plugin.settings.debugMode) {
                console.log(`[LogOperation] Migrating ${legacyLogs.length} legacy logs to file`);
            }
            
            for (const entry of legacyLogs) {
                this.appendToLogFile(entry);
            }
            
            this.plugin.settings.logs = [];
            this.plugin.saveSettings();
        }
    }

    log(action: LogAction, details: string, filePath?: string, taskId?: string): void {
        if (!this.plugin.settings.enableLog) {
            return;
        }

        const today = this.getTodayDateString();
        
        if (today !== this.currentDate) {
            this.handleDateChange(today);
        }

        const logEntry: LogEntry = {
            timestamp: Date.now(),
            action,
            details,
            filePath,
            taskId
        };

        this.todayLogs.push(logEntry);

        if (this.plugin.settings.logFileEnabled) {
            this.logBuffer.push(logEntry);
            if (this.logBuffer.length >= this.BATCH_SIZE) {
                this.flushLogBuffer();
            }
        }

        this.cleanOldLogsIfNeeded();

        if (this.plugin.settings.debugMode) {
            console.log(`[Log] ${action}: ${details}`, { filePath, taskId });
        }
    }

    private handleDateChange(newDate: string): void {
        this.todayLogs = [];
        this.currentDate = newDate;
        
        if (this.plugin.settings.debugMode) {
            console.log(`[LogOperation] Date changed to ${newDate}, buffer cleared`);
        }
    }

    private async appendToLogFile(entry: LogEntry): Promise<void> {
        if (!this.plugin.storagePathManager) {
            console.warn('[LogOperation] StoragePathManager not initialized');
            return;
        }

        try {
            await this.plugin.storagePathManager.ensureAllDirs();
            const logPath = await this.plugin.storagePathManager.getTodayLogPath();
            await this.plugin.storagePathManager.appendJsonToFile(logPath, entry);
        } catch (error) {
            console.error('[LogOperation] Failed to append log to file:', error);
        }
    }

    private async flushLogBuffer(): Promise<void> {
        if (this.logBuffer.length === 0) {
            return;
        }

        if (!this.plugin.storagePathManager) {
            console.warn('[LogOperation] StoragePathManager not initialized');
            this.logBuffer = [];
            return;
        }

        try {
            await this.plugin.storagePathManager.ensureAllDirs();
            const logPath = await this.plugin.storagePathManager.getTodayLogPath();
            
            const adapter = this.plugin.app.vault.adapter;
            let data: LogEntry[] = [];
            
            const exists = await adapter.exists(logPath);
            if (exists) {
                const content = await adapter.read(logPath);
                try {
                    data = JSON.parse(content);
                    if (!Array.isArray(data)) {
                        data = [];
                    }
                } catch {
                    data = [];
                }
            }
            
            data.push(...this.logBuffer);
            await adapter.write(logPath, JSON.stringify(data, null, 2));
            this.logBuffer = [];
            
            if (this.plugin.settings.debugMode) {
                console.log(`[LogOperation] Flushed ${this.logBuffer.length} logs to file`);
            }
        } catch (error) {
            console.error('[LogOperation] Failed to flush log buffer:', error);
        }
    }

    private cleanOldLogsIfNeeded(): void {
        const today = this.getTodayDateString();
        
        if (today === this.lastCleanupDate) {
            return;
        }

        this.lastCleanupDate = today;

        if (this.plugin.settings.logFileEnabled && this.plugin.storagePathManager) {
            this.cleanOldLogs().catch(error => {
                console.error('[LogOperation] Failed to clean old logs:', error);
            });
        }
    }

    private async cleanOldLogs(): Promise<void> {
        const retentionDays = this.plugin.settings.logRetentionDays || 365;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const cutoffString = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;

        try {
            const logsPath = await this.plugin.storagePathManager.getLogsPath();
            const files = await this.plugin.storagePathManager.listFiles(logsPath);
            
            for (const filePath of files) {
                const fileName = filePath.split('/').pop() || '';
                const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
                
                if (dateMatch) {
                    const fileDate = dateMatch[1];
                    if (fileDate < cutoffString) {
                        await this.plugin.storagePathManager.deleteFile(filePath);
                        
                        if (this.plugin.settings.debugMode) {
                            console.log(`[LogOperation] Deleted old log file: ${filePath}`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[LogOperation] Error cleaning old logs:', error);
        }
    }

    getLogs(): LogEntry[] {
        return this.todayLogs;
    }

    getAllLogs(): LogEntry[] {
        if (!this.plugin.settings.logFileEnabled || !this.plugin.storagePathManager) {
            return this.todayLogs;
        }

        return this.todayLogs;
    }

    async getLogsFromFiles(days = 30): Promise<LogEntry[]> {
        if (!this.plugin.settings.logFileEnabled || !this.plugin.storagePathManager) {
            return [];
        }

        const logs: LogEntry[] = [];
        
        try {
            const logsPath = await this.plugin.storagePathManager.getLogsPath();
            const files = await this.plugin.storagePathManager.listFiles(logsPath);
            
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);
            
            for (const filePath of files) {
                const fileName = filePath.split('/').pop() || '';
                const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
                
                if (dateMatch) {
                    const fileDate = new Date(dateMatch[1]);
                    if (fileDate >= cutoffDate) {
                        const data = await this.plugin.storagePathManager.readJsonFile<LogEntry[]>(filePath);
                        if (data && Array.isArray(data)) {
                            logs.push(...data);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[LogOperation] Failed to read logs from files:', error);
        }

        return logs;
    }

    getLogsAsText(): string {
        const logs = this.getLogs();
        if (logs.length === 0) {
            return 'No logs available. (Today\'s logs will appear here)';
        }

        return logs.map(log => {
            const date = new Date(log.timestamp).toLocaleString();
            const fileInfo = log.filePath ? ` [${log.filePath}]` : '';
            const taskInfo = log.taskId ? ` (task: ${log.taskId})` : '';
            return `[${date}] ${log.action}: ${log.details}${fileInfo}${taskInfo}`;
        }).join('\n');
    }

    async getLogsAsTextFromFiles(days = 7): Promise<string> {
        const logs = await this.getLogsFromFiles(days);
        
        if (logs.length === 0) {
            return 'No logs available in files.';
        }

        logs.sort((a, b) => a.timestamp - b.timestamp);

        return logs.map(log => {
            const date = new Date(log.timestamp).toLocaleString();
            const fileInfo = log.filePath ? ` [${log.filePath}]` : '';
            const taskInfo = log.taskId ? ` (task: ${log.taskId})` : '';
            return `[${date}] ${log.action}: ${log.details}${fileInfo}${taskInfo}`;
        }).join('\n');
    }

    clearLogs(): void {
        this.todayLogs = [];
        this.flushLogBuffer();
    }

    async exportLogsToFile(): Promise<string | null> {
        const logsText = await this.getLogsAsTextFromFiles(365);
        
        try {
            const logsPath = await this.plugin.storagePathManager.getLogsPath();
            await this.plugin.storagePathManager.ensureDir(logsPath);
            
            const exportFileName = `logs-export-${this.getTodayDateString()}.md`;
            const exportPath = `${logsPath}/${exportFileName}`;
            
            const adapter = this.app.vault.adapter;
            await adapter.write(exportPath, logsText);
            
            return exportPath;
        } catch (error) {
            console.error('[LogOperation] Failed to export logs:', error);
            return null;
        }
    }

    exportLogs(): string {
        return this.getLogsAsText();
    }
}
