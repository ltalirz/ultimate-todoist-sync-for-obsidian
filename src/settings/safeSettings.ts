import { App, Notice } from 'obsidian';

import { DEFAULT_SETTINGS } from './settings';
import { StoragePathManager } from '../storage/pathManager';
import UltimateTodoistSyncForObsidian from '../../main';

const GHOST_FIELDS = ['todayLogs', 'todoistTasksData', 'syncToken', 'logs', 'logRetentionDays', 'statistics', 'deviceIdGenerated'];
const REQUIRED_FIELDS = ['initialized', 'todoistAPIToken', 'taskFileMapping'];

// ==========================================================================================
// SafeSettings - 设置的完整生命周期管理：加载、保存、运行时变更
// ==========================================================================================

export class SafeSettings {
	private plugin: UltimateTodoistSyncForObsidian;
	private lastBackupTime = 0;
	private static readonly BACKUP_THROTTLE_MS = 5 * 60 * 1000;

	constructor(plugin: UltimateTodoistSyncForObsidian) {
		this.plugin = plugin;
	}


	async load(): Promise<boolean> {
		this.plugin.settingsBackup = new SettingsBackup(this.plugin.app, this.plugin);

		try {
			if (await this.plugin.settingsBackup.hasTempFile()) {
				console.warn('[Settings] Found temp file, attempting recovery...');
				new Notice('Found unsaved changes, attempting recovery...');
				const recovered = await this.plugin.settingsBackup.recoverFromTempFile();
				if (!recovered) {
					new Notice('Failed to recover from unsaved changes, using backup');
					await this.plugin.settingsBackup.restore();
				} else {
					new Notice('Settings recovered from unsaved changes');
				}
			}

			const data = await this.plugin.loadData();

			if (!this.validate(data)) {
				console.warn('[Settings] Settings corrupted, attempting recovery...');
				new Notice('Settings corrupted, attempting recovery...');
				const recovered = await this.plugin.settingsBackup.restore();
				if (recovered) {
					new Notice('Settings recovered from backup');
					const recoveredData = await this.plugin.loadData();
					this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, recoveredData);
					this.stripGhostFields();
					this.sanitizeTaskFileMapping();
					return true;
				}
				console.error('[Settings] Recovery failed, using default settings');
				this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
				new Notice('Settings reset to defaults due to corruption');
				await this.save();
				return true;
			}

			this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, data);
			this.stripGhostFields();
			this.sanitizeTaskFileMapping();
			return true;
		} catch (error) {
			console.error('[Settings] Failed to load data:', error);
			this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
			return true;
		}
	}

	async save(): Promise<boolean> {
		if (this.plugin.saveLock) {
			console.log('[Settings] Save already in progress, skipping...');
			return false;
		}

		this.plugin.saveLock = true;
		const settingsPath = StoragePathManager.SETTINGS_FILE;
		const tempPath = StoragePathManager.SETTINGS_TEMP_FILE;

		try {
			if (!this.plugin.settings || Object.keys(this.plugin.settings).length === 0) {
				console.error('[Settings] Settings are empty or invalid, not saving to avoid data loss.');
				this.plugin.saveLock = false;
				return false;
			}

			if (!this.validate(this.plugin.settings)) {
				console.error('[Settings] Settings validation failed');
				this.plugin.saveLock = false;
				return false;
			}

			const settingsJson = JSON.stringify(this.plugin.settings, null, 2);
			const adapter = this.plugin.app.vault.adapter;

			await adapter.write(tempPath, settingsJson);
			if (!await adapter.exists(tempPath)) {
				throw new Error('Temp file was not created');
			}
			await adapter.write(settingsPath, settingsJson);
			try {
				await adapter.remove(tempPath);
			} catch (cleanupError) {
				console.warn('[Settings] Failed to cleanup temp file:', cleanupError);
			}

			console.log('[Settings] Settings saved successfully');
			this.plugin.saveLock = false;
			return true;
		} catch (error) {
			console.error('[Settings] Error saving settings:', error);
			new Notice('Settings save failed, temp file preserved for recovery');
			this.plugin.saveLock = false;
			return false;
		}
	}

	validate(data: unknown): boolean {
		if (!data || typeof data !== 'object') return false;
		const record = data as Record<string, unknown>;
		for (const field of REQUIRED_FIELDS) {
			if (!(field in record)) {
				console.warn(`[Settings] Missing required field: ${field}`);
				return false;
			}
		}
		if (record.taskFileMapping && typeof record.taskFileMapping !== 'object') return false;
		try {
			JSON.parse(JSON.stringify(data));
			return true;
		} catch {
			return false;
		}
	}

	private stripGhostFields(): void {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		let stripped = 0;
		for (const field of GHOST_FIELDS) {
			if (field in settings) {
				delete settings[field];
				stripped++;
			}
		}
		if (stripped > 0) console.log(`[Settings] Stripped ${stripped} ghost field(s) from loaded data`);
	}

	private sanitizeTaskFileMapping(): void {
		const mapping = this.plugin.settings.taskFileMapping;
		if (!mapping) return;
		let fixed = 0;
		for (const [taskId, entry] of Object.entries(mapping)) {
			if (typeof entry.lineNumber !== 'number') {
				console.warn(`[Settings] taskFileMapping[${taskId}].lineNumber is "${entry.lineNumber}" (${typeof entry.lineNumber}), resetting to 0`);
				entry.lineNumber = 0;
				entry.status = 'issue';
				entry.syncEnabled = false;
				fixed++;
			}
		}
		if (fixed > 0) console.log(`[Settings] Sanitized ${fixed} corrupted taskFileMapping entry(s)`);
	}


	private async throttledBackup(): Promise<void> {
		if (!this.plugin.settingsBackup) return;
		const now = Date.now();
		if (now - this.lastBackupTime < SafeSettings.BACKUP_THROTTLE_MS) return;
		await this.plugin.settingsBackup.backup();
		this.lastBackupTime = now;
	}

	async update(changes: Partial<typeof this.plugin.settings>, shouldSave = false): Promise<void> {
		await this.throttledBackup();
		try {
			Object.assign(this.plugin.settings, changes);
			if (shouldSave) {
				await this.save();
			}
		} catch (error) {
			console.error('[SafeSettings] Update failed:', error);
			if (this.plugin.settingsBackup) {
				await this.plugin.settingsBackup.restore();
			}
			throw error;
		}
	}

	async reset(): Promise<void> {
		if (this.plugin.settingsBackup) {
			await this.plugin.settingsBackup.backup();
		}
		try {
			this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
			await this.save();
		} catch (error) {
			console.error('[SafeSettings] Reset failed:', error);
			if (this.plugin.settingsBackup) {
				await this.plugin.settingsBackup.restore();
			}
			throw error;
		}
	}
}


// ==========================================================================================
// SettingsBackup - Settings JSON 备份恢复
// ==========================================================================================

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
			const backupPath = `${this.getBackupDir()}/settings-${timestamp}.json`;
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
			await adapter.write(StoragePathManager.SETTINGS_FILE, data);
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
			if (!await this.app.vault.adapter.exists(backupDir)) return null;
			const files = this.app.vault.getFiles()
				.filter(f => f.path.startsWith(backupDir + '/') && f.name.startsWith('settings-') && f.name.endsWith('.json'))
				.sort((a, b) => b.stat.mtime - a.stat.mtime);
			return files[0]?.path ?? null;
		} catch (error) {
			console.error('[SettingsBackup] Failed to get latest backup:', error);
			return null;
		}
	}

	async getBackupList(): Promise<string[]> {
		try {
			const backupDir = this.getBackupDir();
			if (!await this.app.vault.adapter.exists(backupDir)) return [];
			const files = this.app.vault.getFiles()
				.filter(f => f.path.startsWith(backupDir + '/') && f.name.startsWith('settings-') && f.name.endsWith('.json'))
				.sort((a, b) => b.stat.mtime - a.stat.mtime);
			return files.map(f => f.path);
		} catch (error) {
			console.error('[SettingsBackup] Failed to get backup list:', error);
			return [];
		}
	}

	async restoreFromSpecific(backupPath: string): Promise<boolean> {
		try {
			const adapter = this.app.vault.adapter;
			if (!await adapter.exists(backupPath)) {
				console.error('[SettingsBackup] Backup file not found:', backupPath);
				return false;
			}
			const data = await adapter.read(backupPath);
			if (!data) return false;
			try {
				JSON.parse(data);
			} catch {
				new Notice('Backup file is corrupted');
				return false;
			}
			await adapter.write(StoragePathManager.SETTINGS_FILE, data);
			console.log('[SettingsBackup] Settings restored from specific backup:', backupPath);
			new Notice('Settings restored from backup');
			return true;
		} catch (error) {
			console.error('[SettingsBackup] Restore from specific failed:', error);
			new Notice('Failed to restore settings from backup');
			return false;
		}
	}

	async recoverFromTempFile(): Promise<boolean> {
		try {
			const tempPath = StoragePathManager.SETTINGS_TEMP_FILE;
			const adapter = this.app.vault.adapter;
			if (!await adapter.exists(tempPath)) return false;
			const data = await adapter.read(tempPath);
			if (!data) return false;
			try {
				JSON.parse(data);
			} catch {
				console.error('[SettingsBackup] Temp file contains invalid JSON');
				await adapter.remove(tempPath).catch(() => {});
				return false;
			}
			await adapter.write(StoragePathManager.SETTINGS_FILE, data);
			await adapter.remove(tempPath).catch(() => {});
			console.log('[SettingsBackup] Recovered from temp file');
			new Notice('Settings recovered from temp file');
			return true;
		} catch (error) {
			console.error('[SettingsBackup] Failed to recover from temp file:', error);
			return false;
		}
	}

	async hasTempFile(): Promise<boolean> {
		return this.app.vault.adapter.exists(StoragePathManager.SETTINGS_TEMP_FILE);
	}

	async clearAllBackups(): Promise<boolean> {
		try {
			const backupDir = this.getBackupDir();
			const adapter = this.app.vault.adapter;
			if (await adapter.exists(backupDir)) {
				await adapter.rmdir(backupDir, true);
				console.log('[SettingsBackup] All backups cleared');
			}
			return true;
		} catch (error) {
			console.error('[SettingsBackup] Failed to clear backups:', error);
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
				const adapter = this.app.vault.adapter;
				for (const file of files.slice(this.maxBackups)) {
					try {
						if (await adapter.exists(file.path)) await adapter.remove(file.path);
					} catch {
						// concurrent cleanup, ignore
					}
				}
			}
		} catch (error) {
			console.error('[SettingsBackup] Failed to clean old backups:', error);
		}
	}
}
