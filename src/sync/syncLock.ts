import UltimateTodoistSyncForObsidian from '../../main';

export type SyncDirection = 'obsidianToTodoist' | 'todoistToObsidian';

export class SyncLockManager {
	private plugin: UltimateTodoistSyncForObsidian;
	private locked = false;

	constructor(plugin: UltimateTodoistSyncForObsidian) {
		this.plugin = plugin;
	}

	get isLocked(): boolean {
		return this.locked;
	}

	release(): void {
		this.locked = false;
	}


	async waitForRelease(): Promise<boolean> {
		let attempts = 0;
		while (this.locked && attempts < 10) {
			await new Promise(resolve => setTimeout(resolve, 1000));
			attempts++;
		}
		const released = !this.locked;
		if (!released) {
			console.warn('[SyncLock] Sync lock acquire FAILED after 10s timeout');
			this.plugin.debugLog('[SyncLock] Sync lock acquire FAILED after 10s timeout');
			this.plugin.logOperation?.log('SYNC_LOCK_TIMEOUT', 'Sync lock acquire failed after 10s timeout');
		}
		return released;
	}

	async waitForSaveRelease(): Promise<boolean> {
		let attempts = 0;
		while (this.plugin.saveLock && attempts < 10) {
			await new Promise(resolve => setTimeout(resolve, 500));
			attempts++;
		}
		const released = !this.plugin.saveLock;
		if (!released) {
			console.warn('[SyncLock] Save lock acquire FAILED after 5s timeout');
			this.plugin.debugLog('[SyncLock] Save lock acquire FAILED after 5s timeout');
			this.plugin.logOperation?.log('SYNC_LOCK_TIMEOUT', 'Save lock acquire failed after 5s timeout');
		}
		return released;
	}

	async acquireExclusive(): Promise<boolean> {
		if (this.plugin.saveLock) {
			this.plugin.debugLog('save locked, waiting before exclusive sync acquire.');
			const saveReleased = await this.waitForSaveRelease();
			if (!saveReleased) {
				this.plugin.debugLog('save lock did not release in time.');
				return false;
			}
		}

		if (this.locked) {
			this.plugin.debugLog('sync locked. waiting for exclusive acquire.');
			const released = await this.waitForRelease();
			if (!released) {
				console.warn('[SyncLock] Exclusive sync lock acquire FAILED after timeout');
				this.plugin.debugLog('[SyncLock] Exclusive sync lock acquire FAILED after timeout');
				return false;
			}
			this.plugin.debugLog('sync unlocked.');
		}

		this.locked = true;
		return true;
	}


	async acquire(direction?: SyncDirection): Promise<boolean> {
		if (!this.plugin.settings.syncEnabled) {
			this.plugin.debugLog('Sync is disabled by user (main switch off)');
			return false;
		}

		if (direction === 'obsidianToTodoist' && !this.plugin.settings.obsidianToTodoistEnabled) {
			this.plugin.debugLog('Obsidian → Todoist sync is disabled by user');
			return false;
		}

		if (direction === 'todoistToObsidian' && !this.plugin.settings.todoistToObsidianEnabled) {
			this.plugin.debugLog('Todoist → Obsidian sync is disabled by user');
			return false;
		}

		if (this.plugin.saveLock) {
			this.plugin.debugLog('save locked, waiting before sync acquire.');
			const saveReleased = await this.waitForSaveRelease();
			if (!saveReleased) {
				this.plugin.debugLog('save lock did not release in time.');
				return false;
			}
		}

		if (this.locked) {
			this.plugin.debugLog('sync locked.');
			const released = await this.waitForRelease();
			if (!released) {
				console.warn(`[SyncLock] Sync lock acquire FAILED for direction=${direction || 'none'}`);
				this.plugin.debugLog(`[SyncLock] Sync lock acquire FAILED for direction=${direction || 'none'}`);
				return false;
			}
			this.plugin.debugLog('sync unlocked.');
		}

		this.locked = true;
		return true;
	}


	async run(direction: SyncDirection, fn: () => Promise<void>): Promise<boolean> {
		if (!await this.acquire(direction)) return false;
		try {
			await fn();
		} catch (error) {
			console.error(`Error during ${direction} sync:`, error);
		} finally {
			this.release();
		}
		return true;
	}
}
