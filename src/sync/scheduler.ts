import UltimateTodoistSyncForObsidian from '../../main';

export class SyncScheduler {
	private plugin: UltimateTodoistSyncForObsidian;
	private inProgress = false;

	constructor(plugin: UltimateTodoistSyncForObsidian) {
		this.plugin = plugin;
	}

	async run(): Promise<void> {
		if (this.inProgress) {
			console.log('Scheduled sync already in progress, skipping');
			return;
		}
		if (!await this.plugin.checkModuleClass()) return;

		this.inProgress = true;
		console.log('Todoist scheduled synchronization task started at', new Date().toLocaleString());

		try {
			await this.plugin.syncLockManager.run('todoistToObsidian', async () => {
				await this.plugin.todoistToObsidian!.syncTodoistToObsidian();
			});

			await this.plugin.saveSettings();
			await new Promise(resolve => setTimeout(resolve, 5000));

			const filesToSync = this.getUniqueFiles();

			if (this.plugin.settings.debugMode) {
				console.log('Files to sync:', filesToSync);
			}

			for (const fileKey of filesToSync) {
				if (this.plugin.settings.debugMode) {
					console.log('Syncing file:', fileKey);
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
		} catch (error) {
			console.error('An error occurred during scheduled sync:', error);
			this.plugin.syncLockManager.release();
		}

		try {
			await this.plugin.logOperation?.flushToFile();
		} catch (error) {
			console.error('An error occurred in flushToFile:', error);
		}

		this.inProgress = false;
		console.log('Todoist scheduled synchronization task completed at', new Date().toLocaleString());
	}

	private getUniqueFiles(): string[] {
		const seen = new Set<string>();
		for (const entry of Object.values(this.plugin.settings.taskFileMapping)) {
			seen.add(entry.filePath);
		}
		return Array.from(seen);
	}
}
