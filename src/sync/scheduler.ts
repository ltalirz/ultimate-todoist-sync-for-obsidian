import UltimateTodoistSyncForObsidian from '../../main';

export class SyncScheduler {
	private plugin: UltimateTodoistSyncForObsidian;
	private inProgress = false;

	constructor(plugin: UltimateTodoistSyncForObsidian) {
		this.plugin = plugin;
	}

	async run(): Promise<void> {
		if (this.inProgress) {
			this.plugin.debugLog('Scheduled sync already in progress, skipping');
			return;
		}
		if (!await this.plugin.checkModuleClass()) return;

		this.inProgress = true;
		this.plugin.debugLog('Todoist scheduled synchronization task started at', new Date().toLocaleString());

		try {
			// Periodic full sync: every 24h, reset sync_token to force full sync
			const FULL_SYNC_INTERVAL = 24 * 60 * 60 * 1000;
			const lastFullSync = this.plugin.settings.lastFullSyncTime || 0;
			if (Date.now() - lastFullSync > FULL_SYNC_INTERVAL) {
				this.plugin.debugLog('Periodic full sync triggered');
				try {
					await this.plugin.todoistSyncAPI.initializeSync();
					await this.plugin.safeSettings?.update({ lastFullSyncTime: Date.now() }, true);
				} catch (error) {
					console.error('[Scheduler] Periodic full sync failed:', error);
				}
			}

			await this.plugin.syncLockManager.run('todoistToObsidian', async () => {
				await this.plugin.todoistToObsidian!.syncTodoistToObsidian();
			});

			await this.plugin.saveSettings();
			await new Promise(resolve => setTimeout(resolve, 5000));

			const filesToSync = this.getUniqueFiles();

			if (this.plugin.settings.debugMode) {
				this.plugin.debugLog('Files to sync:', filesToSync);
			}

			for (const fileKey of filesToSync) {
				if (this.plugin.settings.debugMode) {
					this.plugin.debugLog('Syncing file:', fileKey);
				}

				const lockOk = await this.plugin.syncLockManager.run('obsidianToTodoist', async () => {
					await this.plugin.obsidianToTodoist!.fullTextNewTaskCheck(fileKey);
				});
				if (!lockOk) continue;

				await this.plugin.syncLockManager.run('obsidianToTodoist', async () => {
					await this.plugin.obsidianToTodoist!.deletedTaskCheck(fileKey);
				});

				await this.plugin.syncLockManager.run('obsidianToTodoist', async () => {
					await this.plugin.obsidianToTodoist!.fullTextModifiedTaskCheck(fileKey);
				});
			}
			// Periodic database check: every 72h, run three-way consistency check
			const DB_CHECK_INTERVAL = 72 * 60 * 60 * 1000;
			const lastDbCheck = this.plugin.settings.lastDatabaseCheckAutoTime || 0;
			if (Date.now() - lastDbCheck > DB_CHECK_INTERVAL) {
				this.plugin.debugLog('Periodic database check triggered');
				try {
					if (this.plugin.databaseChecker) {
						await this.plugin.databaseChecker.checkDatabase();
						await this.plugin.safeSettings?.update({ lastDatabaseCheckAutoTime: Date.now() }, true);
					}
				} catch (error) {
					console.error('[Scheduler] Periodic database check failed:', error);
				}
			}
		} catch (error) {
			console.error('An error occurred during scheduled sync:', error);
		} finally {
			try {
				await this.plugin.logOperation?.flushToFile();
			} catch (error) {
				console.error('An error occurred in flushToFile:', error);
			}
			this.inProgress = false;
			this.plugin.debugLog('Todoist scheduled synchronization task completed at', new Date().toLocaleString());
		}
	}

	private getUniqueFiles(): string[] {
		const seen = new Set<string>();
		for (const entry of Object.values(this.plugin.settings.taskFileMapping)) {
			seen.add(entry.filePath);
		}
		return Array.from(seen);
	}
}
