import { Notice } from 'obsidian';

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
		return !this.locked;
	}


	async acquire(direction?: SyncDirection): Promise<boolean> {
		if (!this.plugin.settings.lastDatabaseCheckPassed) {
			this.plugin.debugLog('Sync is disabled due to database issues');
			new Notice('Sync is blocked due to database issues. Please fix the issues first.');
			return false;
		}

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

		if (this.locked) {
			this.plugin.debugLog('sync locked.');
			const released = await this.waitForRelease();
			if (!released) return false;
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
