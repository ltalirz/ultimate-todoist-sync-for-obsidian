import { App } from 'obsidian';
import UltimateTodoistSyncForObsidian from "../main";

export class BackupOperation {
    app: App;
    plugin: UltimateTodoistSyncForObsidian;
    private backupFolder = '.ultimate-todoist-backup';
    private maxBackupsPerFile = 5;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    async ensureBackupFolderExists(): Promise<void> {
        const folderExists = this.app.vault.getAbstractFileByPath(this.backupFolder);
        if (!folderExists) {
            await this.app.vault.createFolder(this.backupFolder);
        }
    }

    async backupFile(filePath: string): Promise<string | null> {
        try {
            await this.ensureBackupFolderExists();

            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (!file || !(file instanceof this.app.vault.getFiles().constructor)) {
                console.log(`File not found: ${filePath}`);
                return null;
            }

            const content = await this.app.vault.read(file as any);
            const now = new Date();
            const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
            
            const fileName = filePath.replace(/[/\\]/g, '_');
            const backupFileName = `${fileName}-${timestamp}.md`;
            const backupPath = `${this.backupFolder}/${backupFileName}`;

            await this.app.vault.create(backupPath, content);

            await this.cleanOldBackups(filePath);

            this.plugin.logOperation?.log('BACKUP_CREATED', `Backed up file before modification: ${filePath}`, filePath);

            return backupPath;
        } catch (error) {
            console.error(`Failed to backup file ${filePath}:`, error);
            return null;
        }
    }

    private async cleanOldBackups(originalFilePath: string): Promise<void> {
        try {
            const fileName = originalFilePath.replace(/[/\\]/g, '_');
            const prefix = `${fileName}-`;
            
            const backupFolder = this.app.vault.getAbstractFileByPath(this.backupFolder);
            if (!backupFolder) return;

            const files = this.app.vault.getFiles()
                .filter(f => f.path.startsWith(this.backupFolder) && f.name.startsWith(prefix))
                .sort((a, b) => b.stat.mtime - a.stat.mtime);

            if (files.length > this.maxBackupsPerFile) {
                const filesToDelete = files.slice(this.maxBackupsPerFile);
                for (const file of filesToDelete) {
                    await this.app.vault.delete(file);
                }
            }
        } catch (error) {
            console.error(`Failed to clean old backups for ${originalFilePath}:`, error);
        }
    }

    async getBackupList(filePath?: string): Promise<string[]> {
        try {
            const backups: string[] = [];
            const files = this.app.vault.getFiles()
                .filter(f => f.path.startsWith(this.backupFolder));

            for (const file of files) {
                if (filePath) {
                    const fileName = filePath.replace(/[/\\]/g, '_');
                    if (file.name.startsWith(`${fileName}-`)) {
                        backups.push(file.path);
                    }
                } else {
                    backups.push(file.path);
                }
            }

            return backups.sort().reverse();
        } catch (error) {
            console.error('Failed to get backup list:', error);
            return [];
        }
    }

    async restoreFromBackup(backupPath: string): Promise<boolean> {
        try {
            const backupFile = this.app.vault.getAbstractFileByPath(backupPath);
            if (!backupFile) {
                console.log(`Backup file not found: ${backupPath}`);
                return false;
            }

            const content = await this.app.vault.read(backupFile as any);
            
            const fileName = backupFile.name.replace(/-\d{8}-\d{6}\.md$/, '').replace(/_/g, '/');
            const originalPath = fileName.replace('.md', '');

            const originalFile = this.app.vault.getAbstractFileByPath(originalPath);
            if (!originalFile) {
                console.log(`Original file not found: ${originalPath}`);
                return false;
            }

            await this.app.vault.modify(originalFile as any, content);
            
            this.plugin.logOperation?.log('BACKUP_CREATED', `Restored file from backup: ${originalPath}`, originalPath);
            
            return true;
        } catch (error) {
            console.error(`Failed to restore from backup:`, error);
            return false;
        }
    }

    async clearAllBackups(): Promise<void> {
        try {
            const files = this.app.vault.getFiles()
                .filter(f => f.path.startsWith(this.backupFolder));

            for (const file of files) {
                await this.app.vault.delete(file);
            }

            const backupFolder = this.app.vault.getAbstractFileByPath(this.backupFolder);
            if (backupFolder) {
                await this.app.vault.delete(backupFolder);
            }

            this.plugin.logOperation?.log('BACKUP_CREATED', 'All backups cleared');
        } catch (error) {
            console.error('Failed to clear backups:', error);
        }
    }
}
