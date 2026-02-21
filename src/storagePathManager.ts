import { App } from 'obsidian';
import UltimateTodoistSyncForObsidian from '../main';

export class StoragePathManager {
    private app: App;
    private plugin: UltimateTodoistSyncForObsidian;
    private basePath = '.ultimate-todoist-sync';

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
        return `${this.basePath}/backups/files`;
    }

    getBackupsTodoistPath(): string {
        return `${this.basePath}/backups/todoist`;
    }

    async getLogsPath(): Promise<string> {
        const deviceId = await this.plugin.deviceManager?.getDeviceId() || 'unknown';
        return `${this.getLogsBasePath()}/${deviceId}`;
    }

    async getTodayLogFileName(): Promise<string> {
        const now = new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        return `${date}.json`;
    }

    async getTodayLogPath(): Promise<string> {
        const logsPath = await this.getLogsPath();
        const fileName = await this.getTodayLogFileName();
        return `${logsPath}/${fileName}`;
    }

    getBackupFileName(originalPath: string): string {
        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const safePath = originalPath.replace(/[/\\]/g, '_');
        return `${safePath}_${timestamp}.md`;
    }

    getTodoistBackupFileName(): string {
        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        return `todoist-data_${timestamp}.json`;
    }

    async ensureDir(path: string): Promise<void> {
        try {
            const adapter = this.app.vault.adapter;
            const exists = await adapter.exists(path);
            if (!exists) {
                await adapter.mkdir(path);
            }
        } catch (error) {
            console.error(`[StoragePathManager] Failed to ensure directory ${path}:`, error);
        }
    }

    async ensureAllDirs(): Promise<void> {
        await this.ensureDir(this.basePath);
        await this.ensureDir(this.getLogsBasePath());
        await this.ensureDir(await this.getLogsPath());
        await this.ensureDir(this.getBackupsBasePath());
        await this.ensureDir(this.getBackupsFilesPath());
        await this.ensureDir(this.getBackupsTodoistPath());
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

    async appendJsonToFile(path: string, newData: unknown): Promise<boolean> {
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
            return true;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to append to JSON file ${path}:`, error);
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
            for (const file of allFiles) {
                if (file.path.startsWith(dirPath + '/')) {
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
}
