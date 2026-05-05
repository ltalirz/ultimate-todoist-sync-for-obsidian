import UltimateTodoistSyncForObsidian from "../../main";
import { App, Notice, TFile } from 'obsidian';
import { StoragePathManager } from '../storage/pathManager';

export class TodoistToObsidianSync {
    app: App;
    plugin: UltimateTodoistSyncForObsidian;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    async syncTodoistToObsidian(): Promise<void> {
        try {
            this.plugin.logOperation?.log('SYNC_START', 'Starting sync from Todoist to Obsidian', undefined, undefined, 'todoist→obsidian');

            await this.plugin.todoistSyncAPI!.incrementalSync();

            const syncData = this.plugin.todoistSyncAPI!.getSyncData();
            if (!syncData?.items) {
                this.plugin.debugLog('[Todoist→Obsidian] No sync data available');
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

            // Resolve legacy numeric IDs → new string IDs so we can look up
            // tasks in the Sync API response (which uses new IDs).
            const cacheTaskIds = Object.keys(taskFileMapping);
            const idMapping = await this.resolveTaskIds(cacheTaskIds);

            // Set flag: file writes below are from Todoist pull, not user edits
            this.plugin.isSyncingFromTodoist = true;
            try {
                for (const taskId of cacheTaskIds) {
                    const mapping = taskFileMapping[taskId];
                    if (mapping.syncEnabled === false) continue;

                    const resolvedId = idMapping[taskId] || taskId;
                    const task = itemMap.get(resolvedId) || itemMap.get(taskId);

                    if (!task || task.is_deleted) {
                        if (this.plugin.settings.debugMode) {
                            this.plugin.debugLog(`[Todoist→Obsidian] Task ${taskId} deleted or not found in sync data`);
                        }
                        continue;
                    }

                    if (task.updated_at === mapping.updated_at) {
                        continue;
                    }

                    if (this.plugin.settings.debugMode) {
                        this.plugin.debugLog(`[Todoist→Obsidian] Task ${taskId} changed: ${mapping.updated_at} → ${task.updated_at}`);
                    }

                    try {
                        await this.syncSingleTaskToObsidian(taskId, task);
                        syncedCount++;
                        await this.plugin.cacheOperation!.updateTaskMappingSyncMeta(taskId, {
                            updated_at: task.updated_at,
                            note_count: task.note_count || 0
                        });
                    } catch (error) {
                        console.error(`[Todoist→Obsidian] Error syncing task ${taskId}:`, error);
                    }
                }

                await this.syncNotesToObsidian(taskFileMapping, noteMap, idMapping);
            } finally {
                this.plugin.isSyncingFromTodoist = false;
            }

            if (syncedCount > 0) {
                this.plugin.logOperation?.log('SYNC_COMPLETED', `Synced ${syncedCount} tasks from Todoist to Obsidian`);
            }
        } catch (err) {
            console.error('An error occurred while synchronizing:', err);
            this.plugin.logOperation?.log('SYNC_ERROR', `Sync failed: ${(err as Error).message}`, undefined, undefined, 'todoist→obsidian');
            new Notice(`Todoist sync failed: ${(err as Error).message}`);
        }
    }

    private async syncSingleTaskToObsidian(taskId: string, task: any): Promise<void> {
        const mapping = this.plugin.cacheOperation!.getTaskFileMapping(taskId);
        if (!mapping) {
            console.warn(`[syncSingleTaskToObsidian] No mapping found for task ${taskId}`);
            this.plugin.debugLog(`[syncSingleTaskToObsidian] No mapping found for task ${taskId}`);
            this.plugin.logOperation?.log('SYNC_TARGET_MISSING', `Todoist→Obsidian sync skipped: no mapping for task ${taskId}`, undefined, taskId);
            return;
        }

        const file = this.app.vault.getAbstractFileByPath(mapping.filePath);
        if (!file) {
            console.warn(`[syncSingleTaskToObsidian] File not found: ${mapping.filePath} (task ${taskId})`);
            this.plugin.debugLog(`[syncSingleTaskToObsidian] File not found: ${mapping.filePath} (task ${taskId})`);
            this.plugin.logOperation?.log('SYNC_TARGET_MISSING', `Todoist→Obsidian sync skipped: file not found ${mapping.filePath}`, mapping.filePath, taskId);
            return;
        }

        const fileContent = await this.app.vault.read(file as TFile);
        const lines = fileContent.split('\n');

        let taskLine = '';
        for (const line of lines) {
            if (line.includes(taskId) && this.plugin.taskParser!.hasTodoistTag(line)) {
                taskLine = line;
                break;
            }
        }
        if (!taskLine) {
            console.warn(`[syncSingleTaskToObsidian] Task line not found in file for task ${taskId}`);
            this.plugin.debugLog(`[syncSingleTaskToObsidian] Task line not found in file for task ${taskId}`);
            this.plugin.logOperation?.log('SYNC_TARGET_MISSING', `Todoist→Obsidian sync skipped: task line not found in file`, mapping.filePath, taskId);
            return;
        }

        const obsidianIsChecked = /\[(x|X)\]/.test(taskLine);
        const todoistIsChecked = task.checked || false;

        if (todoistIsChecked && !obsidianIsChecked) {
            await this.plugin.fileOperation!.completeTaskInTheFile(taskId);
            new Notice(`Task ${taskId} completed from Todoist`);
            this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Task completed in Todoist: ${taskId}`, mapping.filePath, taskId, 'todoist→obsidian');
        } else if (!todoistIsChecked && obsidianIsChecked) {
            await this.plugin.fileOperation!.uncompleteTaskInTheFile(taskId);
            new Notice(`Task ${taskId} reopened from Todoist`);
            this.plugin.logOperation?.log('TODOIST_TASK_REOPENED', `Task reopened in Todoist: ${taskId}`, mapping.filePath, taskId, 'todoist→obsidian');
        }

        const obsidianContent = this.plugin.taskParser!.getTaskContentFromLineText(taskLine);
        if (obsidianContent && task.content && obsidianContent !== task.content) {
            await this.plugin.fileOperation!.syncTaskContentToFile(taskId, task.content);
            this.plugin.logOperation?.log('FILE_TASK_CONTENT_SYNCED', `Synced content: ${taskId}`, mapping.filePath, taskId, 'todoist→obsidian');
        }

        const obsidianDueDate = this.plugin.taskParser!.getDueDateFromLineText(taskLine) || "";
        const todoistDueDate = task.due?.date ? (this.plugin.taskParser!.ISOStringToLocalDateString(task.due.date) || "") : "";
        if (obsidianDueDate !== todoistDueDate) {
            await this.plugin.fileOperation!.syncTaskDueDateToFile(taskId, task.due?.date || "");
            this.plugin.logOperation?.log('FILE_TASK_DUEDATE_SYNCED', `Synced due date: ${taskId}`, mapping.filePath, taskId, 'todoist→obsidian');
        }

        const prioritySynced = await this.plugin.fileOperation!.syncTaskPriorityToFile(taskId, task.priority || 1);
        if (prioritySynced) {
            this.plugin.logOperation?.log('FILE_TASK_PRIORITY_SYNCED', `Synced priority: ${taskId}`, mapping.filePath, taskId, 'todoist→obsidian');
        }

        const labelsSynced = await this.plugin.fileOperation!.syncTaskLabelsToFile(taskId, task.labels || []);
        if (labelsSynced) {
            this.plugin.logOperation?.log('FILE_TASK_LABELS_SYNCED', `Synced labels: ${taskId}`, mapping.filePath, taskId, 'todoist→obsidian');
        }
    }

    private async syncNotesToObsidian(
        taskFileMapping: Record<string, { note_count?: number; syncEnabled?: boolean }>,
        noteMap: Map<string, any[]>,
        idMapping: Record<string, string>
    ): Promise<void> {
        // Build reverse map: newId → cacheId so we can look up noteMap entries
        // (keyed by new IDs from syncData) against taskFileMapping (keyed by
        // cache IDs which may be legacy numeric IDs).
        const reverseIdMap = new Map<string, string>();
        for (const [cacheId, resolvedId] of Object.entries(idMapping)) {
            if (resolvedId !== cacheId) {
                reverseIdMap.set(resolvedId, cacheId);
            }
        }

        for (const [noteTaskId, notes] of noteMap.entries()) {
            // noteTaskId is from syncData (new ID). Find corresponding cache ID.
            const taskId = reverseIdMap.get(noteTaskId) || noteTaskId;
            const mapping = taskFileMapping[taskId];
            if (!mapping) continue;
            if (mapping.syncEnabled === false) continue;

            const storedNoteCount = mapping.note_count || 0;
            if (notes.length <= storedNoteCount) continue;

            const sortedNotes = notes.sort((a: any, b: any) =>
                new Date(a.posted_at || a.added_at || 0).getTime() - new Date(b.posted_at || b.added_at || 0).getTime()
            );

            const newNotes = sortedNotes.slice(storedNoteCount);
            for (const note of newNotes) {
                try {
                    const dateStr = this.plugin.taskParser!.ISOStringToLocalDatetimeString(note.posted_at || note.added_at || '');
                    await this.plugin.fileOperation!.syncTaskNoteToFile(taskId, note.content || '', dateStr ?? '');
                    new Notice(`Note synced to task ${taskId}`);
                } catch (error) {
                    console.error(`[Todoist→Obsidian] Error syncing note for task ${taskId}:`, error);
                }
            }

            await this.plugin.cacheOperation!.updateTaskMappingSyncMeta(taskId, {
                note_count: notes.length
            });
        }
    }

    /**
     * Resolve legacy numeric task IDs to new string IDs via the REST API
     * ID mapping endpoint. Returns a map of oldId → newId for any IDs that
     * were translated; non-legacy IDs are excluded.
     */
    private async resolveTaskIds(taskIds: string[]): Promise<Record<string, string>> {
        const restApi = this.plugin.todoistRestAPI;
        if (!restApi) return {};
        try {
            return await restApi.resolveIds('tasks', taskIds);
        } catch (err) {
            console.warn('[Todoist→Obsidian] Failed to resolve legacy task IDs, proceeding with original IDs:', err);
            return {};
        }
    }

    async backupTodoistAllResources(): Promise<void> {
        try {
            const todoistSyncAPI = this.plugin.todoistSyncAPI;
            if (!todoistSyncAPI) {
                throw new Error('Todoist sync API is not initialized');
            }

            const resources = await todoistSyncAPI.getAllResources(true);

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
            this.plugin.logOperation?.log('BACKUP_FAILED', `Backup failed: ${(error as Error).message}`);
            new Notice('Todoist backup failed');
        }
    }
}
