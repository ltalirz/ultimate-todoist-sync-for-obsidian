import { App } from 'obsidian';
import UltimateTodoistSyncForObsidian from "../../main";

export interface LogEntry {
    timestamp: number;
    action: string;
    details: string;
    filePath?: string;
    taskId?: string;
}

export class LogOperation {
    private app: App;
    private plugin: UltimateTodoistSyncForObsidian;
    private memoryLogs: LogEntry[] = [];
    private unsavedLogs: LogEntry[] = [];
    private isFlushing = false;
    private readonly BATCH_SIZE = 20;
    private readonly MAX_MEMORY_LOGS = 500;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    async loadFromFile(): Promise<void> {
        if (!this.plugin.settings.logFileEnabled || !this.plugin.storagePathManager) {
            return;
        }

        try {
            const logPath = this.plugin.storagePathManager.getLogFilePath();
            const adapter = this.app.vault.adapter;

            const exists = await adapter.exists(logPath);
            if (!exists) return;

            const content = await adapter.read(logPath);
            if (!content) return;

            try {
                const data = JSON.parse(content);
                if (Array.isArray(data)) {
                    this.memoryLogs = data.slice(-this.MAX_MEMORY_LOGS);
                }
            } catch {
                this.memoryLogs = [];
            }
        } catch (error) {
            console.error('[LogOperation] Failed to load logs from file:', error);
        }
    }

    log(action: string, details: string, filePath?: string, taskId?: string): void {
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

        this.memoryLogs.push(logEntry);
        if (this.memoryLogs.length > this.MAX_MEMORY_LOGS) {
            this.memoryLogs = this.memoryLogs.slice(-this.MAX_MEMORY_LOGS);
        }

        if (this.plugin.settings.logFileEnabled) {
            this.unsavedLogs.push(logEntry);
            if (this.unsavedLogs.length >= this.BATCH_SIZE) {
                this.flushToFile();
            }
        }

        if (this.plugin.settings.debugMode) {
            console.log(`[Log] ${action}: ${details}`, { filePath, taskId });
        }
    }

    public async flushToFile(): Promise<void> {
        if (!this.plugin.settings.logFileEnabled || !this.plugin.storagePathManager) {
            this.unsavedLogs = [];
            return;
        }

        if (this.isFlushing) return;
        this.isFlushing = true;

        try {
            await this.plugin.storagePathManager.ensureDir(
                this.plugin.storagePathManager.getLogsBasePath()
            );

            const logPath = this.plugin.storagePathManager.getLogFilePath();
            const adapter = this.app.vault.adapter;

            const toFlush = this.unsavedLogs;
            this.unsavedLogs = [];

            if (toFlush.length === 0) return;

            const fileLogs = await this.readLogsFromDisk(adapter, logPath);
            fileLogs.push(...toFlush);

            const maxSize = this.plugin.settings.maxLogFileSize || (1024 * 1024);
            let output = JSON.stringify(fileLogs);

            if (output.length > maxSize) {
                const retentionPercent = this.plugin.settings.logRetentionPercent || 80;
                const keepCount = Math.floor(fileLogs.length * retentionPercent / 100);
                const trimmed = fileLogs.slice(-keepCount);
                output = JSON.stringify(trimmed);
            }

            await adapter.write(logPath, output);
        } catch (error) {
            console.error('[LogOperation] Failed to flush logs to file:', error);
        } finally {
            this.isFlushing = false;
        }
    }

    private async readLogsFromDisk(adapter: any, logPath: string): Promise<LogEntry[]> {
        try {
            const exists = await adapter.exists(logPath);
            if (!exists) return [];

            const content = await adapter.read(logPath);
            if (!content) return [];

            const parsed = JSON.parse(content);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    async clearLogs(): Promise<void> {
        this.memoryLogs = [];
        this.unsavedLogs = [];

        if (this.plugin.storagePathManager) {
            try {
                const logPath = this.plugin.storagePathManager.getLogFilePath();
                const adapter = this.app.vault.adapter;
                const exists = await adapter.exists(logPath);
                if (exists) {
                    await adapter.write(logPath, '[]');
                }
            } catch (error) {
                console.error('[LogOperation] Failed to clear log file:', error);
            }
        }
    }

    getLogs(): LogEntry[] {
        return [...this.memoryLogs];
    }

    getLogsAsText(): string {
        if (this.memoryLogs.length === 0) {
            return 'No logs available.';
        }

        return this.memoryLogs.map(log => {
            const date = new Date(log.timestamp).toLocaleString();
            const fileInfo = log.filePath ? ` [${log.filePath}]` : '';
            const taskInfo = log.taskId ? ` (task: ${log.taskId})` : '';
            return `[${date}] ${log.action}: ${log.details}${fileInfo}${taskInfo}`;
        }).join('\n');
    }
}
