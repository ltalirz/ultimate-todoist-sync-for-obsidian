import { App, Notice } from 'obsidian';
import UltimateTodoistSyncForObsidian from '../main';
import { StoragePathManager } from './storagePathManager';

export class SettingsBackup {
    private app: App;
    private plugin: UltimateTodoistSyncForObsidian;
    private maxBackups = 5;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    private getBackupDir(): string {
        return this.plugin.storagePathManager?.getBackupsSettingsPath() 
            || '.ultimate-todoist-sync/backups/settings';
    }

    private async ensureBackupDir(): Promise<void> {
        await this.plugin.storagePathManager?.ensureDir(this.getBackupDir());
    }

    async backup(): Promise<boolean> {
        try {
            await this.ensureBackupDir();

            const settingsPath = StoragePathManager.SETTINGS_FILE;
            const adapter = this.app.vault.adapter;
            
            const exists = await adapter.exists(settingsPath);
            if (!exists) {
                console.warn('[SettingsBackup] No settings data to backup');
                return false;
            }

            const data = await adapter.read(settingsPath);
            if (!data) {
                console.warn('[SettingsBackup] No settings data to backup');
                return false;
            }

            try {
                JSON.parse(data);
            } catch {
                console.error('[SettingsBackup] Settings file contains invalid JSON, skipping backup');
                return false;
            }

            const now = new Date();
            const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
            
            const backupFileName = `settings-${timestamp}.json`;
            const backupPath = `${this.getBackupDir()}/${backupFileName}`;

            await adapter.write(backupPath, data);
            console.log('[SettingsBackup] Backup created:', backupPath);

            await this.cleanOldBackups();

            return true;
        } catch (error) {
            console.error('[SettingsBackup] Backup failed:', error);
            return false;
        }
    }

    async restore(): Promise<boolean> {
        try {
            const latestBackup = await this.getLatestBackup();
            if (!latestBackup) {
                console.warn('[SettingsBackup] No backup found to restore');
                return false;
            }

            const adapter = this.app.vault.adapter;
            const data = await adapter.read(latestBackup);
            if (!data) {
                console.error('[SettingsBackup] Failed to read backup file');
                return false;
            }

            try {
                JSON.parse(data);
            } catch {
                console.error('[SettingsBackup] Backup contains invalid JSON, cannot restore');
                new Notice('Backup file is corrupted, cannot restore');
                return false;
            }

            const settingsPath = StoragePathManager.SETTINGS_FILE;
            await adapter.write(settingsPath, data);
            
            console.log('[SettingsBackup] Settings restored from:', latestBackup);
            new Notice('Settings restored from backup');

            return true;
        } catch (error) {
            console.error('[SettingsBackup] Restore failed:', error);
            new Notice('Failed to restore settings from backup');
            return false;
        }
    }

    async getLatestBackup(): Promise<string | null> {
        try {
            const backupDir = this.getBackupDir();
            const adapter = this.app.vault.adapter;
            
            const exists = await adapter.exists(backupDir);
            if (!exists) {
                console.log('[SettingsBackup] Backup directory does not exist');
                return null;
            }

            const files = this.app.vault.getFiles()
                .filter(f => f.path.startsWith(backupDir + '/') && f.name.startsWith('settings-') && f.name.endsWith('.json'))
                .sort((a, b) => b.stat.mtime - a.stat.mtime);

            if (files.length === 0) {
                console.log('[SettingsBackup] No backup files found');
                return null;
            }

            return files[0].path;
        } catch (error) {
            console.error('[SettingsBackup] Failed to get latest backup:', error);
            return null;
        }
    }

    async getBackupList(): Promise<string[]> {
        try {
            const backupDir = this.getBackupDir();
            const adapter = this.app.vault.adapter;
            
            const dirExists = await adapter.exists(backupDir);
            if (!dirExists) {
                console.log('[SettingsBackup] Backup directory does not exist:', backupDir);
                return [];
            }

            const files = this.app.vault.getFiles()
                .filter(f => f.path.startsWith(backupDir + '/') && f.name.startsWith('settings-') && f.name.endsWith('.json'))
                .sort((a, b) => b.stat.mtime - a.stat.mtime);

            console.log('[SettingsBackup] Found backup files:', files.map(f => f.path));
            return files.map(f => f.path);
        } catch (error) {
            console.error('[SettingsBackup] Failed to get backup list:', error);
            return [];
        }
    }

    async restoreFromSpecific(backupPath: string): Promise<boolean> {
        try {
            const adapter = this.app.vault.adapter;
            const exists = await adapter.exists(backupPath);
            if (!exists) {
                console.error('[SettingsBackup] Backup file not found:', backupPath);
                return false;
            }

            const data = await adapter.read(backupPath);
            if (!data) {
                console.error('[SettingsBackup] Failed to read backup file');
                return false;
            }

            try {
                JSON.parse(data);
            } catch {
                console.error('[SettingsBackup] Backup contains invalid JSON');
                new Notice('Backup file is corrupted');
                return false;
            }

            const settingsPath = StoragePathManager.SETTINGS_FILE;
            await adapter.write(settingsPath, data);
            
            console.log('[SettingsBackup] Settings restored from specific backup:', backupPath);
            new Notice('Settings restored from backup');

            return true;
        } catch (error) {
            console.error('[SettingsBackup] Restore from specific failed:', error);
            new Notice('Failed to restore settings from backup');
            return false;
        }
    }

    private async cleanOldBackups(): Promise<void> {
        try {
            const backupDir = this.getBackupDir();
            const files = this.app.vault.getFiles()
                .filter(f => f.path.startsWith(backupDir + '/') && f.name.startsWith('settings-'))
                .sort((a, b) => b.stat.mtime - a.stat.mtime);

            if (files.length > this.maxBackups) {
                const filesToDelete = files.slice(this.maxBackups);
                const adapter = this.app.vault.adapter;
                for (const file of filesToDelete) {
                    await adapter.remove(file.path);
                    console.log('[SettingsBackup] Deleted old backup:', file.path);
                }
            }
        } catch (error) {
            console.error('[SettingsBackup] Failed to clean old backups:', error);
        }
    }

    async recoverFromTempFile(): Promise<boolean> {
        try {
            const tempPath = StoragePathManager.SETTINGS_TEMP_FILE;
            const adapter = this.app.vault.adapter;
            
            const exists = await adapter.exists(tempPath);
            if (!exists) {
                console.log('[SettingsBackup] No temp file found');
                return false;
            }

            const data = await adapter.read(tempPath);
            if (!data) {
                console.error('[SettingsBackup] Failed to read temp file');
                return false;
            }

            try {
                JSON.parse(data);
            } catch {
                console.error('[SettingsBackup] Temp file contains invalid JSON');
                await adapter.remove(tempPath);
                return false;
            }

            const settingsPath = StoragePathManager.SETTINGS_FILE;
            await adapter.write(settingsPath, data);
            
            await adapter.remove(tempPath);
            
            console.log('[SettingsBackup] Recovered from temp file');
            new Notice('Settings recovered from temp file');
            return true;
        } catch (error) {
            console.error('[SettingsBackup] Failed to recover from temp file:', error);
            return false;
        }
    }

    async hasTempFile(): Promise<boolean> {
        return await this.app.vault.adapter.exists(StoragePathManager.SETTINGS_TEMP_FILE);
    }

    async clearAllBackups(): Promise<boolean> {
        try {
            const backupDir = this.getBackupDir();
            const adapter = this.app.vault.adapter;
            const exists = await adapter.exists(backupDir);
            if (exists) {
                await adapter.rmdir(backupDir, true);
                console.log('[SettingsBackup] All backups cleared');
            }
            return true;
        } catch (error) {
            console.error('[SettingsBackup] Failed to clear backups:', error);
            return false;
        }
    }
}
