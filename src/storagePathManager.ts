import { App } from 'obsidian';
import UltimateTodoistSyncForObsidian from '../main';

export class StoragePathManager {
    private app: App;
    private plugin: UltimateTodoistSyncForObsidian;
    private basePath = '.ultimate-todoist-sync';
    private appendLock = false;

    static readonly SETTINGS_FILE = '.obsidian/plugins/ultimate-todoist-sync-for-obsidian/data.json';
    static readonly SETTINGS_TEMP_FILE = '.obsidian/plugins/ultimate-todoist-sync-for-obsidian/data.json.tmp';
    static readonly BACKUPS_TODOIST_FILE = '.ultimate-todoist-sync/backups/todoist';
    static readonly BACKUPS_FILES_FILE = '.ultimate-todoist-sync/backups/files';
    static readonly BACKUPS_SETTINGS_FILE = '.ultimate-todoist-sync/backups/settings';

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    getBasePath(): string {
        return this.basePath;
    }

    getLogsBasePath(): string {
        return `${this.basePath}/logs`;
    }

    getBackupsBasePath(): string {
        return `${this.basePath}/backups`;
    }

    getBackupsFilesPath(): string {
        return StoragePathManager.BACKUPS_FILES_FILE;
    }

    getBackupsTodoistPath(): string {
        return StoragePathManager.BACKUPS_TODOIST_FILE;
    }

    getBackupsSettingsPath(): string {
        return StoragePathManager.BACKUPS_SETTINGS_FILE;
    }

    async getLogsPath(): Promise<string> {
        const deviceId = await this.plugin.deviceManager?.getDeviceId() || 'unknown';
        return `${this.getLogsBasePath()}/${deviceId}`;
    }

    async getTodayLogFileName(): Promise<string> {
        const now = new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const deviceId = await this.plugin.deviceManager?.getDeviceId() || 'unknown';
        return `${deviceId}_${date}.json`;
    }

    async getTodayLogPath(): Promise<string> {
        const logsPath = await this.getLogsPath();
        const fileName = await this.getTodayLogFileName();
        return this.joinPath(logsPath, fileName);
    }

    getBackupFileName(originalPath: string): string {
        const timestamp = this.generateTimestamp();
        const safePath = originalPath.replace(/[/\\]/g, '_');
        return `${safePath}_${timestamp}.md`;
    }

    getTodoistBackupFileName(): string {
        const timestamp = this.generateTimestamp();
        return `todoist-data_${timestamp}.json`;
    }

    getSettingsBackupFileName(): string {
        const timestamp = this.generateTimestamp();
        return `settings-${timestamp}.json`;
    }

    private generateTimestamp(): string {
        const now = new Date();
        return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    }

    private joinPath(...parts: string[]): string {
        return parts.join('/');
    }

    async ensureDir(path: string): Promise<boolean> {
        try {
            const adapter = this.app.vault.adapter;
            const exists = await adapter.exists(path);
            if (!exists) {
                await adapter.mkdir(path);
            }
            return true;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to ensure directory ${path}:`, error);
            return false;
        }
    }

    async ensureAllDirs(): Promise<boolean> {
        const dirs = [
            this.basePath,
            this.getLogsBasePath(),
            StoragePathManager.BACKUPS_TODOIST_FILE,
            StoragePathManager.BACKUPS_FILES_FILE,
            StoragePathManager.BACKUPS_SETTINGS_FILE
        ];

        for (const dir of dirs) {
            const success = await this.ensureDir(dir);
            if (!success) {
                console.error(`[StoragePathManager] Failed to create directory: ${dir}`);
                return false;
            }
        }

        try {
            const logsPath = await this.getLogsPath();
            const success = await this.ensureDir(logsPath);
            if (!success) {
                console.error(`[StoragePathManager] Failed to create logs directory: ${logsPath}`);
                return false;
            }
        } catch (error) {
            console.error(`[StoragePathManager] Failed to create logs directory:`, error);
            return false;
        }

        return true;
    }

    async readJsonFile<T>(path: string): Promise<T | null> {
        try {
            const adapter = this.app.vault.adapter;
            const exists = await adapter.exists(path);
            if (!exists) {
                return null;
            }
            const content = await adapter.read(path);
            return JSON.parse(content) as T;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to read JSON file ${path}:`, error);
            return null;
        }
    }

    async writeJsonFile<T>(path: string, data: T): Promise<boolean> {
        try {
            const adapter = this.app.vault.adapter;
            await adapter.write(path, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to write JSON file ${path}:`, error);
            return false;
        }
    }

    async writeJsonFileAtomic<T>(path: string, data: T): Promise<boolean> {
        const tempPath = `${path}.tmp`;
        const jsonContent = JSON.stringify(data, null, 2);
        const adapter = this.app.vault.adapter;

        try {
            await adapter.write(tempPath, jsonContent);
            const exists = await adapter.exists(tempPath);
            if (!exists) {
                throw new Error('Temp file was not created');
            }

            await adapter.write(path, jsonContent);

            try {
                await adapter.remove(tempPath);
            } catch (cleanupError) {
                console.warn(`[StoragePathManager] Failed to cleanup temp file:`, cleanupError);
            }

            return true;
        } catch (error) {
            console.error(`[StoragePathManager] Atomic write failed for ${path}:`, error);
            return false;
        }
    }

    async appendJsonToFile(path: string, newData: unknown): Promise<boolean> {
        if (this.appendLock) {
            console.warn('[StoragePathManager] Append in progress, skipping...');
            return false;
        }

        this.appendLock = true;
        try {
            const adapter = this.app.vault.adapter;
            let data: unknown[] = [];
            
            const exists = await adapter.exists(path);
            if (exists) {
                const content = await adapter.read(path);
                try {
                    data = JSON.parse(content);
                    if (!Array.isArray(data)) {
                        data = [];
                    }
                } catch {
                    data = [];
                }
            }
            
            data.push(newData);
            await adapter.write(path, JSON.stringify(data, null, 2));
            this.appendLock = false;
            return true;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to append to JSON file ${path}:`, error);
            this.appendLock = false;
            return false;
        }
    }

    async listFiles(dirPath: string): Promise<string[]> {
        try {
            const adapter = this.app.vault.adapter;
            const exists = await adapter.exists(dirPath);
            if (!exists) {
                return [];
            }
            
            const files: string[] = [];
            const allFiles = this.app.vault.getFiles();
            const prefix = dirPath + '/';
            for (const file of allFiles) {
                if (file.path.startsWith(prefix)) {
                    files.push(file.path);
                }
            }
            return files;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to list files in ${dirPath}:`, error);
            return [];
        }
    }

    async deleteFile(path: string): Promise<boolean> {
        try {
            const adapter = this.app.vault.adapter;
            const exists = await adapter.exists(path);
            if (exists) {
                await adapter.remove(path);
            }
            return true;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to delete file ${path}:`, error);
            return false;
        }
    }

    async getFileSize(path: string): Promise<number> {
        try {
            const adapter = this.app.vault.adapter;
            const exists = await adapter.exists(path);
            if (!exists) {
                return 0;
            }
            const content = await adapter.read(path);
            return content.length;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to get file size ${path}:`, error);
            return 0;
        }
    }

    async getDirSize(dirPath: string): Promise<number> {
        try {
            const files = await this.listFiles(dirPath);
            let totalSize = 0;
            for (const filePath of files) {
                const size = await this.getFileSize(filePath);
                totalSize += size;
            }
            return totalSize;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to get directory size ${dirPath}:`, error);
            return 0;
        }
    }

    async cleanOldBackups(dirPath: string, maxCount: number, namePrefix?: string): Promise<void> {
        try {
            let files = await this.listFiles(dirPath);
            
            if (namePrefix) {
                files = files.filter(f => {
                    const fileName = f.split('/').pop() || '';
                    return fileName.startsWith(namePrefix);
                });
            }

            if (files.length <= maxCount) {
                return;
            }

            const fileObjects = files.map(path => {
                const file = this.app.vault.getAbstractFileByPath(path) as import('obsidian').TFile | null;
                return {
                    path,
                    mtime: file?.stat.mtime || 0
                };
            });

            fileObjects.sort((a, b) => b.mtime - a.mtime);

            const filesToDelete = fileObjects.slice(maxCount);
            for (const file of filesToDelete) {
                await this.deleteFile(file.path);
                console.log(`[StoragePathManager] Deleted old backup: ${file.path}`);
            }
        } catch (error) {
            console.error(`[StoragePathManager] Failed to clean old backups in ${dirPath}:`, error);
        }
    }
}
