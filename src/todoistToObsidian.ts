import UltimateTodoistSyncForObsidian from "../main";
import { App, Notice } from 'obsidian';

export class TodoistToObsidianSync {
    app: App;
    plugin: UltimateTodoistSyncForObsidian;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    async syncCompletedTaskStatusToObsidian(unSynchronizedEvents: unknown[]): Promise<void> {
        try {
            const processedEvents = [];
            for (const e of unSynchronizedEvents) {
                const event = e as { object_id: string };
                await this.plugin.fileOperation.completeTaskInTheFile(event.object_id);
                await this.plugin.cacheOperation.closeTaskToCacheByID(event.object_id);
                new Notice(`Task ${event.object_id} is closed.`);
                this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Task completed in Todoist: ${event.object_id}`, undefined, event.object_id);
                processedEvents.push(e);
            }

            await this.plugin.cacheOperation.appendEventsToCache(processedEvents);
            this.plugin.saveSettings();

        } catch (error) {
            console.error('Error syncing task status:', error);
        }
    }

    async syncUncompletedTaskStatusToObsidian(unSynchronizedEvents: unknown[]): Promise<void> {
        try {
            const processedEvents = [];
            for (const e of unSynchronizedEvents) {
                const event = e as { object_id: string };
                await this.plugin.fileOperation.uncompleteTaskInTheFile(event.object_id);
                await this.plugin.cacheOperation.reopenTaskToCacheByID(event.object_id);
                new Notice(`Task ${event.object_id} is reopened.`);
                this.plugin.logOperation?.log('TODOIST_TASK_REOPENED', `Task reopened in Todoist: ${event.object_id}`, undefined, event.object_id);
                processedEvents.push(e);
            }

            await this.plugin.cacheOperation.appendEventsToCache(processedEvents);
            this.plugin.saveSettings();
        } catch (error) {
            console.error('Error syncing task status:', error);
        }
    }

    async syncUpdatedTaskToObsidian(unSynchronizedEvents: unknown[]): Promise<void> {
        try {
            const processedEvents = [];

            for (const e of unSynchronizedEvents) {
                const event = e as { object_id: string; event_type: string };
                console.log(`Processing event: ${event.event_type} for task ${event.object_id}`);

                if (event.event_type === 'content') {
                    await this.syncUpdatedTaskContentToObsidian(e);
                } else if (event.event_type === 'due_date') {
                    await this.syncUpdatedTaskDueDateToObsidian(e);
                }

                processedEvents.push(e);
            }

            await this.plugin.cacheOperation.appendEventsToCache(processedEvents);
            this.plugin.saveSettings();

        } catch (error) {
            console.error('Error syncing updated tasks:', error);
        }
    }

    async syncUpdatedTaskContentToObsidian(e: unknown): Promise<void> {
        const event = e as { object_id: string; extra_data: { content: string } };
        await this.plugin.fileOperation.syncUpdatedTaskContentToTheFile(event);
        this.plugin.logOperation?.log('FILE_TASK_CONTENT_SYNCED', `Synced task content from Todoist: ${event.object_id}`, undefined, event.object_id);
    }

    async syncUpdatedTaskDueDateToObsidian(e: unknown): Promise<void> {
        const event = e as { object_id: string; extra_data: { due_date: string } };
        await this.plugin.fileOperation.syncUpdatedTaskDueDateToTheFile(event);
        this.plugin.logOperation?.log('FILE_TASK_DUEDATE_SYNCED', `Synced task due date from Todoist: ${event.object_id}`, undefined, event.object_id);
    }

    async syncAddedTaskNoteToObsidian(unSynchronizedEvents: unknown[]): Promise<void> {
        try {
            const processedEvents = [];

            for (const e of unSynchronizedEvents) {
                const event = e as { parent_item_id: string };
                await this.plugin.fileOperation.syncAddedTaskNoteToTheFile(e);
                new Notice(`Note added to task ${event.parent_item_id}`);
                this.plugin.logOperation?.log('FILE_TASK_NOTE_ADDED', `Synced note from Todoist: ${event.parent_item_id}`, undefined, event.parent_item_id);
                processedEvents.push(e);
            }

            await this.plugin.cacheOperation.appendEventsToCache(processedEvents);
            this.plugin.saveSettings();

        } catch (error) {
            console.error('Error syncing task notes:', error);
        }
    }

    async syncTodoistToObsidian(): Promise<void> {
        try {
            this.plugin.logOperation?.log('SYNC_START', 'Starting sync from Todoist to Obsidian');
            const all_activity_events = await this.plugin.todoistSyncAPI.getNonObsidianAllActivityEvents();

            const savedEvents = await this.plugin.cacheOperation.loadEventsFromCache();
            const result1 = all_activity_events.filter(
                (objA: { id: string }) => !savedEvents.some((objB: { id: string }) => objB.id === objA.id)
            );

            const savedTasks = await this.plugin.cacheOperation.loadTasksFromCache();
            const result2 = result1.filter(
                (objA: { object_id: string }) => savedTasks.some((objB: { id: string }) => objB.id === objA.object_id)
            );
            const result3 = result1.filter(
                (objA: { parent_item_id: string }) => savedTasks.some((objB: { id: string }) => objB.id === objA.parent_item_id)
            );

            const unsynchronized_item_completed_events = this.plugin.todoistSyncAPI.filterActivityEvents(result2, { event_type: 'completed', object_type: 'item' });
            const unsynchronized_item_uncompleted_events = this.plugin.todoistSyncAPI.filterActivityEvents(result2, { event_type: 'uncompleted', object_type: 'item' });
            const unsynchronized_item_updated_events = this.plugin.todoistSyncAPI.filterActivityEvents(result2, { event_type: 'updated', object_type: 'item' });
            const unsynchronized_notes_added_events = this.plugin.todoistSyncAPI.filterActivityEvents(result3, { event_type: 'added', object_type: 'note' });
            const unsynchronized_project_events = this.plugin.todoistSyncAPI.filterActivityEvents(result1, { object_type: 'project' });

            console.log(unsynchronized_item_completed_events);
            console.log(unsynchronized_item_uncompleted_events);
            console.log(unsynchronized_item_updated_events);
            console.log(unsynchronized_project_events);
            console.log(unsynchronized_notes_added_events);

            await this.syncCompletedTaskStatusToObsidian(unsynchronized_item_completed_events);
            await this.syncUncompletedTaskStatusToObsidian(unsynchronized_item_uncompleted_events);
            await this.syncUpdatedTaskToObsidian(unsynchronized_item_updated_events);
            await this.syncAddedTaskNoteToObsidian(unsynchronized_notes_added_events);

            if (unsynchronized_project_events.length) {
                console.log('New project event');
                await this.plugin.cacheOperation.saveProjectsToCache();
                await this.plugin.cacheOperation.appendEventsToCache(unsynchronized_project_events);
            }

            this.plugin.logOperation?.log('SYNC_COMPLETED', 'Sync from Todoist to Obsidian completed');

        } catch (err) {
            console.error('An error occurred while synchronizing:', err);
            this.plugin.logOperation?.log('SYNC_ERROR', `Sync failed: ${(err as Error).message}`);
        }
    }

    async backupTodoistAllResources(): Promise<void> {
        try {
            const resources = await this.plugin.todoistSyncAPI.getAllResources();

            const now: Date = new Date();
            const timeString = `${now.getFullYear()}${now.getMonth() + 1}${now.getDate()}-${now.getHours()}${now.getMinutes()}${now.getSeconds()}`;

            const backupFolder = '.todoist-backups';
            const fileName = `backup-${timeString}.json`;
            const fullPath = `${backupFolder}/${fileName}`;

            // Create backup folder if it doesn't exist
            const folderExists = this.app.vault.getAbstractFileByPath(backupFolder);
            if (!folderExists) {
                await this.app.vault.createFolder(backupFolder);
            }

            await this.app.vault.create(fullPath, JSON.stringify(resources, null, 2));
            new Notice(`Todoist backup saved to ${fullPath}`);
            this.plugin.logOperation?.log('BACKUP_CREATED', `Todoist backup created: ${fullPath}`);
        } catch (error) {
            console.error("An error occurred while creating Todoist backup:", error);
            this.plugin.logOperation?.log('BACKUP_CREATED', `Backup failed: ${(error as Error).message}`);
        }
    }
}
