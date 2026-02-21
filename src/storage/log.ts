import { App } from 'obsidian';
import UltimateTodoistSyncForObsidian from "../../main";

export interface LogEntry {
    timestamp: number;
    action: string;
    details: string;
    filePath?: string;
    taskId?: string;
}

export type LogAction = string;

export class LogOperation {
    private app: App;
    private plugin: UltimateTodoistSyncForObsidian;
    private memoryLogs: LogEntry[] = [];
    private unsavedCount = 0;
    private readonly BATCH_SIZE = 20;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
        this.loadLogsFromFile();
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

        if (this.plugin.settings.logFileEnabled) {
            this.unsavedCount++;
            if (this.unsavedCount >= this.BATCH_SIZE) {
                this.flushToFile();
            }
        }

        if (this.plugin.settings.debugMode) {
            console.log(`[Log] ${action}: ${details}`, { filePath, taskId });
        }
    }

    private async loadLogsFromFileAsync(): Promise<void> {
        if (!this.plugin.settings.logFileEnabled || !this.plugin.storagePathManager) {
            return;
        }

        try {
            const logPath = this.plugin.storagePathManager.getLogFilePath();
            const adapter = this.app.vault.adapter;
            
            const exists = await adapter.exists(logPath);
            if (exists) {
                const content = await adapter.read(logPath);
                if (content) {
                    try {
                        const data = JSON.parse(content);
                        if (Array.isArray(data)) {
                            this.memoryLogs = data;
                            if (this.plugin.settings.debugMode) {
                                console.log(`[LogOperation] Loaded ${data.length} logs from file`);
                            }
                        }
                    } catch {
                        this.memoryLogs = [];
                    }
                }
            }
        } catch (error) {
            console.error('[LogOperation] Failed to load logs from file:', error);
            this.memoryLogs = [];
        }
    }

    private loadLogsFromFile(): void {
        this.loadLogsFromFileAsync();
    }

    public async flushToFile(): Promise<void> {
        if (!this.plugin.settings.logFileEnabled || !this.plugin.storagePathManager) {
            this.unsavedCount = 0;
            return;
        }

        try {
            await this.plugin.storagePathManager.ensureDir(
                this.plugin.storagePathManager.getLogsBasePath()
            );
            
            const logPath = this.plugin.storagePathManager.getLogFilePath();
            const adapter = this.app.vault.adapter;
            
            let currentLogs: LogEntry[] = [];
            const exists = await adapter.exists(logPath);
            if (exists) {
                const content = await adapter.read(logPath);
                if (content) {
                    try {
                        currentLogs = JSON.parse(content);
                        if (!Array.isArray(currentLogs)) {
                            currentLogs = [];
                        }
                    } catch {
                        currentLogs = [];
                    }
                }
            }

            const maxSize = this.plugin.settings.maxLogFileSize || (1024 * 1024);
            const content = JSON.stringify(currentLogs, null, 2);
            const currentSize = content.length;

            if (currentSize > maxSize) {
                await this.cleanupBySize();
            } else {
                currentLogs.push(...this.memoryLogs);
                await adapter.write(logPath, JSON.stringify(currentLogs, null, 2));
            }

            this.memoryLogs = [];
            this.unsavedCount = 0;

            if (this.plugin.settings.debugMode) {
                console.log(`[LogOperation] Flushed logs to file`);
            }
        } catch (error) {
            console.error('[LogOperation] Failed to flush logs to file:', error);
        }
    }

    private async cleanupBySize(): Promise<void> {
        try {
            const logPath = this.plugin.storagePathManager!.getLogFilePath();
            const adapter = this.app.vault.adapter;
            
            let currentLogs: LogEntry[] = [];
            const exists = await adapter.exists(logPath);
            if (exists) {
                const content = await adapter.read(logPath);
                if (content) {
                    try {
                        currentLogs = JSON.parse(content);
                        if (!Array.isArray(currentLogs)) {
                            currentLogs = [];
                        }
                    } catch {
                        currentLogs = [];
                    }
                }
            }

            const retentionPercent = this.plugin.settings.logRetentionPercent || 80;
            const keepCount = Math.floor(currentLogs.length * retentionPercent / 100);
            const trimmedLogs = currentLogs.slice(-keepCount);

            trimmedLogs.push(...this.memoryLogs);
            await adapter.write(logPath, JSON.stringify(trimmedLogs, null, 2));
            
            this.memoryLogs = trimmedLogs.slice(-this.BATCH_SIZE);

            if (this.plugin.settings.debugMode) {
                console.log(`[LogOperation] Cleaned up logs, kept ${keepCount} entries`);
            }
        } catch (error) {
            console.error('[LogOperation] Failed to cleanup logs:', error);
        }
    }

    getLogs(): LogEntry[] {
        return this.memoryLogs;
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
        this.memoryLogs = [];
        this.flushToFile();
    }
}
