import UltimateTodoistSyncForObsidian from "../main";
import { App, Notice } from 'obsidian';
import { StoragePathManager } from './storagePathManager';

export class TodoistToObsidianSync {
    app: App;
    plugin: UltimateTodoistSyncForObsidian;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    async syncTodoistToObsidian(): Promise<void> {
        try {
            this.plugin.logOperation?.log('SYNC_START', 'Starting sync from Todoist to Obsidian');

            await this.plugin.todoistSyncAPI.incrementalSync();

            const syncData = this.plugin.todoistSyncAPI.getSyncData();
            if (!syncData?.items) {
                console.log('[Todoist→Obsidian] No sync data available');
                return;
            }

            const itemMap = new Map<string, any>();
            for (const item of syncData.items) {
                itemMap.set(item.id, item);
            }

            const noteMap = new Map<string, any[]>();
            if (syncData.notes) {
                for (const note of syncData.notes) {
                    const taskId = note.item_id;
                    if (!noteMap.has(taskId)) noteMap.set(taskId, []);
                    noteMap.get(taskId)!.push(note);
                }
            }

            const taskFileMapping = this.plugin.settings.taskFileMapping || {};
            let syncedCount = 0;

            for (const taskId of Object.keys(taskFileMapping)) {
                const mapping = taskFileMapping[taskId];
                const task = itemMap.get(taskId);

                if (!task || task.is_deleted) {
                    if (this.plugin.settings.debugMode) {
                        console.log(`[Todoist→Obsidian] Task ${taskId} deleted or not found in sync data`);
                    }
                    continue;
                }

                if (task.updated_at === mapping.updated_at) {
                    continue;
                }

                if (this.plugin.settings.debugMode) {
                    console.log(`[Todoist→Obsidian] Task ${taskId} changed: ${mapping.updated_at} → ${task.updated_at}`);
                }

                try {
                    await this.syncSingleTaskToObsidian(taskId, task);
                    syncedCount++;
                } catch (error) {
                    console.error(`[Todoist→Obsidian] Error syncing task ${taskId}:`, error);
                }

                this.plugin.cacheOperation.updateTaskMappingSyncMeta(taskId, {
                    updated_at: task.updated_at,
                    note_count: task.note_count || 0
                });
            }

            this.syncNotesToObsidian(taskFileMapping, noteMap);

            if (syncedCount > 0) {
                this.plugin.logOperation?.log('SYNC_COMPLETED', `Synced ${syncedCount} tasks from Todoist to Obsidian`);
            }
        } catch (err) {
            console.error('An error occurred while synchronizing:', err);
            this.plugin.logOperation?.log('SYNC_ERROR', `Sync failed: ${(err as Error).message}`);
        }
    }

    private async syncSingleTaskToObsidian(taskId: string, task: any): Promise<void> {
        const mapping = this.plugin.cacheOperation.getTaskFileMapping(taskId);
        if (!mapping) return;

        const file = this.app.vault.getAbstractFileByPath(mapping.filePath);
        if (!file) return;

        const fileContent = await this.app.vault.read(file);
        const lines = fileContent.split('\n');

        let taskLine = '';
        for (const line of lines) {
            if (line.includes(taskId) && this.plugin.taskParser.hasTodoistTag(line)) {
                taskLine = line;
                break;
            }
        }
        if (!taskLine) return;

        const obsidianIsChecked = /\[(x|X)\]/.test(taskLine);
        const todoistIsChecked = task.checked || false;

        if (todoistIsChecked && !obsidianIsChecked) {
            await this.plugin.fileOperation.completeTaskInTheFile(taskId);
            new Notice(`Task ${taskId} completed from Todoist`);
            this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Task completed in Todoist: ${taskId}`, mapping.filePath, taskId);
        } else if (!todoistIsChecked && obsidianIsChecked) {
            await this.plugin.fileOperation.uncompleteTaskInTheFile(taskId);
            new Notice(`Task ${taskId} reopened from Todoist`);
            this.plugin.logOperation?.log('TODOIST_TASK_REOPENED', `Task reopened in Todoist: ${taskId}`, mapping.filePath, taskId);
        }

        const obsidianContent = this.plugin.taskParser.getTaskContentFromLineText(taskLine);
        if (obsidianContent && task.content && obsidianContent !== task.content) {
            await this.plugin.fileOperation.syncTaskContentToFile(taskId, task.content);
            this.plugin.logOperation?.log('FILE_TASK_CONTENT_SYNCED', `Synced content: ${taskId}`, mapping.filePath, taskId);
        }

        const obsidianDueDate = this.plugin.taskParser.getDueDateFromLineText(taskLine) || "";
        const todoistDueDate = task.due?.date ? (this.plugin.taskParser.ISOStringToLocalDateString(task.due.date) || "") : "";
        if (obsidianDueDate !== todoistDueDate) {
            await this.plugin.fileOperation.syncTaskDueDateToFile(taskId, task.due?.date || "");
            this.plugin.logOperation?.log('FILE_TASK_DUEDATE_SYNCED', `Synced due date: ${taskId}`, mapping.filePath, taskId);
        }
    }

    private async syncNotesToObsidian(
        taskFileMapping: Record<string, { note_count?: number }>,
        noteMap: Map<string, any[]>
    ): Promise<void> {
        for (const [taskId, notes] of noteMap.entries()) {
            const mapping = taskFileMapping[taskId];
            if (!mapping) continue;

            const storedNoteCount = mapping.note_count || 0;
            if (notes.length <= storedNoteCount) continue;

            const sortedNotes = notes.sort((a: any, b: any) =>
                new Date(a.posted_at || a.added_at || 0).getTime() - new Date(b.posted_at || b.added_at || 0).getTime()
            );

            const newNotes = sortedNotes.slice(storedNoteCount);
            for (const note of newNotes) {
                try {
                    const dateStr = this.plugin.taskParser.ISOStringToLocalDatetimeString(note.posted_at || note.added_at || '');
                    await this.plugin.fileOperation.syncTaskNoteToFile(taskId, note.content || '', dateStr);
                    new Notice(`Note synced to task ${taskId}`);
                } catch (error) {
                    console.error(`[Todoist→Obsidian] Error syncing note for task ${taskId}:`, error);
                }
            }

            this.plugin.cacheOperation.updateTaskMappingSyncMeta(taskId, {
                note_count: notes.length
            });
        }
    }

    async backupTodoistAllResources(): Promise<void> {
        try {
            const resources = await this.plugin.todoistSyncAPI.getAllResources(true);

            const now: Date = new Date();
            const timeString = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

            const backupFolder = this.plugin.storagePathManager?.getBackupsTodoistPath() || 'ultimate-todoist-sync/backups/todoist';
            const tempFileName = `todoist-data-backup-${timeString}.tmp`;
            const fileName = `todoist-data-backup-${timeString}.json`;
            const tempPath = `${backupFolder}/${tempFileName}`;
            const fullPath = `${backupFolder}/${fileName}`;

            const adapter = this.app.vault.adapter;
            const folderExists = await adapter.exists(backupFolder);
            if (!folderExists) {
                await adapter.mkdir(backupFolder);
            }

            const jsonContent = JSON.stringify(resources, null, 2);
            
            await adapter.write(tempPath, jsonContent);
            const tempExists = await adapter.exists(tempPath);
            if (!tempExists) {
                throw new Error('Temp backup file was not created');
            }

            await adapter.write(fullPath, jsonContent);
            
            const verifyExists = await adapter.exists(fullPath);
            if (!verifyExists) {
                throw new Error('Backup file verification failed');
            }

            try {
                await adapter.remove(tempPath);
            } catch (cleanupError) {
                console.warn('[TodoistBackup] Failed to cleanup temp file:', cleanupError);
            }

            new Notice(`Todoist backup saved to ${fullPath}`);
            this.plugin.logOperation?.log('BACKUP_CREATED', `Todoist backup created: ${fullPath}`);
        } catch (error) {
            console.error("An error occurred while creating Todoist backup:", error);
            this.plugin.logOperation?.log('BACKUP_CREATED', `Backup failed: ${(error as Error).message}`);
            new Notice('Todoist backup failed');
        }
    }
}
