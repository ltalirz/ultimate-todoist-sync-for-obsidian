import { App, Notice } from 'obsidian';

import { DEFAULT_SETTINGS, TaskIssueEntry } from './settings';
import { StoragePathManager } from '../storage/pathManager';
import UltimateTodoistSyncForObsidian from '../../main';
import { DeviceManager } from '../utils/deviceManager';
import { normalizeTaskIssueTypeKey, reconcileTaskEntryDerivedState } from '../data/taskIssueUtils';

const KNOWN_SETTINGS_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const REQUIRED_FIELDS = ['initialized', 'todoistAPIToken', 'taskFileMapping'];
const CURRENT_SCHEMA_VERSION = 1;


type TaskMappingEntry = {
	filePath: string;
	status?: 'active' | 'nonActive' | 'conflicted' | 'issue';
	syncEnabled?: boolean;
	updated_at?: string;
	note_count?: number;
	issues?: Record<string, TaskIssueEntry>;
};

// ==========================================================================================
// SafeSettings - 设置的完整生命周期管理：加载、保存、运行时变更
// ==========================================================================================

export class SafeSettings {
	private plugin: UltimateTodoistSyncForObsidian;
	private lastBackupTime = 0;
	private static readonly BACKUP_THROTTLE_MS = 5 * 60 * 1000;
	private static readonly SAVE_DEBOUNCE_MS = 1200;
	private settingsIoQueue: Promise<void> = Promise.resolve();
	private saveDebounceTimer: number | null = null;
	private hasDirtyChanges = false;
	private lastSavedSnapshot = '';

	constructor(plugin: UltimateTodoistSyncForObsidian) {
		this.plugin = plugin;
	}

	public async withSettingsIOLock<T>(_operation: string, fn: () => Promise<T>): Promise<T> {
		const run = this.settingsIoQueue.then(async () => {
			this.plugin.saveLock = true;
			try {
				return await fn();
			} finally {
				this.plugin.saveLock = false;
			}
		}, async () => {
			this.plugin.saveLock = true;
			try {
				return await fn();
			} finally {
				this.plugin.saveLock = false;
			}
		});

		this.settingsIoQueue = run.then(() => undefined, () => undefined);
		return run;
	}

	private buildSettingsSnapshot(): string {
		return JSON.stringify(this.plugin.settings, null, 2);
	}

	private markPersisted(snapshot: string): void {
		this.hasDirtyChanges = false;
		this.lastSavedSnapshot = snapshot;
	}

	private markDirty(): void {
		this.hasDirtyChanges = true;
	}

	private syncPersistedStateFromMemory(isDirty: boolean): void {
		try {
			this.lastSavedSnapshot = this.buildSettingsSnapshot();
			this.hasDirtyChanges = isDirty;
		} catch (error) {
			console.error('[Settings] Failed to sync persisted state snapshot:', error);
			this.lastSavedSnapshot = '';
			this.hasDirtyChanges = true;
		}
	}

	private cancelDebouncedSave(): void {
		if (this.saveDebounceTimer !== null) {
			window.clearTimeout(this.saveDebounceTimer);
			this.saveDebounceTimer = null;
		}
	}

	private scheduleDebouncedSave(): void {
		this.cancelDebouncedSave();
		this.saveDebounceTimer = window.setTimeout(() => {
			this.saveDebounceTimer = null;
			this.save().catch(error => {
				console.error('[Settings] Debounced save failed:', error);
			});
		}, SafeSettings.SAVE_DEBOUNCE_MS);
	}

	private async reloadSettingsFromDisk(): Promise<boolean> {
		const rawData = await this.plugin.loadData();
		if (!this.isLoadDataUsable(rawData)) return false;

		const normalizedData = this.normalizeLoadedData(rawData);
		this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, normalizedData);
		this.stripUnknownFields();
		this.sanitizeTaskFileMapping();
		this.syncPersistedStateFromMemory(false);
		return true;
	}

	async restoreFromLatestBackup(): Promise<boolean> {
		if (!this.plugin.settingsBackup) return false;
		const restored = await this.plugin.settingsBackup.restore();
		if (!restored) return false;
		return this.reloadSettingsFromDisk();
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

			const rawData = await this.plugin.loadData();

			if (rawData === null || rawData === undefined) {
				this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
				this.syncPersistedStateFromMemory(false);
				return true;
			}

			if (!this.isLoadDataUsable(rawData)) {
				console.warn('[Settings] Settings corrupted, attempting recovery...');
				new Notice('Settings corrupted, attempting recovery...');
				const recovered = await this.plugin.settingsBackup.restore();
				if (recovered) {
					new Notice('Settings recovered from backup');
					const recoveredData = await this.plugin.loadData();
					const normalizedRecoveredData = this.isLoadDataUsable(recoveredData)
						? this.normalizeLoadedData(recoveredData)
						: {};
					this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, normalizedRecoveredData);
					this.stripUnknownFields();
					this.sanitizeTaskFileMapping();
					this.syncPersistedStateFromMemory(false);
					return true;
				}
				console.error('[Settings] Recovery failed, using default settings in memory only');
				this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
				new Notice('Settings appear corrupted and recovery failed. Plugin stopped to avoid overwriting data.json.');
				return false;
			}

			const data = this.normalizeLoadedData(rawData);
			this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, data);
			this.stripUnknownFields();
			this.sanitizeTaskFileMapping();
			// Run schema migrations (v0 → v1 → ... → CURRENT_SCHEMA_VERSION)
			await this.runMigrations(rawData);
			this.syncPersistedStateFromMemory(false);

			return true;
		} catch (error) {
			console.error('[Settings] Failed to load data:', error);

			try {
				const recovered = await this.plugin.settingsBackup.restore();
				if (recovered) {
					const recoveredData = await this.plugin.loadData();
					const normalizedRecoveredData = this.isLoadDataUsable(recoveredData)
						? this.normalizeLoadedData(recoveredData)
						: {};
					this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, normalizedRecoveredData);
					this.stripUnknownFields();
					this.sanitizeTaskFileMapping();
					this.syncPersistedStateFromMemory(false);
					new Notice('Settings recovered from backup after load failure');
					return true;
				}
			} catch (restoreError) {
				console.error('[Settings] Backup restore after load failure also failed:', restoreError);
			}

			this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
			this.syncPersistedStateFromMemory(false);
			new Notice('Settings load failed. Loaded defaults in memory only; original data was not overwritten.');
			return false;
		}
	}

	private isLoadDataUsable(data: unknown): data is Record<string, unknown> {
		if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
		try {
			JSON.parse(JSON.stringify(data));
			return true;
		} catch {
			return false;
		}
	}

	private normalizeLoadedData(data: Record<string, unknown>): Record<string, unknown> {
		const normalized: Record<string, unknown> = { ...data };

		if (typeof normalized.syncInterval === 'number' && typeof normalized.automaticSynchronizationInterval !== 'number') {
			normalized.automaticSynchronizationInterval = normalized.syncInterval;
		}

		if (typeof normalized.todoistApiToken === 'string' && typeof normalized.todoistAPIToken !== 'string') {
			normalized.todoistAPIToken = normalized.todoistApiToken;
		}

		if (!normalized.taskFileMapping || typeof normalized.taskFileMapping !== 'object' || Array.isArray(normalized.taskFileMapping)) {
			normalized.taskFileMapping = {};
		}

		const taskFileMapping = normalized.taskFileMapping as Record<string, unknown>;
		if (Object.keys(taskFileMapping).length === 0) {
			const legacyMapping = this.buildLegacyTaskFileMapping(normalized);
			if (Object.keys(legacyMapping).length > 0) {
				normalized.taskFileMapping = legacyMapping;
				this.plugin.debugLog(`[Settings] Migrated ${Object.keys(legacyMapping).length} mapping entries from legacy todoistTasksData`);
			}
		}

		if (!normalized.fileMetadata || typeof normalized.fileMetadata !== 'object' || Array.isArray(normalized.fileMetadata)) {
			normalized.fileMetadata = {};
		}

		return normalized;
	}

	private buildLegacyTaskFileMapping(data: Record<string, unknown>): Record<string, TaskMappingEntry> {
		const legacyCache = data.todoistTasksData;
		if (!legacyCache || typeof legacyCache !== 'object' || Array.isArray(legacyCache)) return {};

		const tasks = (legacyCache as Record<string, unknown>).tasks;
		if (!Array.isArray(tasks)) return {};

		const migrated: Record<string, TaskMappingEntry> = {};
		for (const task of tasks) {
			if (!task || typeof task !== 'object' || Array.isArray(task)) continue;

			const legacyTask = task as Record<string, unknown>;
			const rawTaskId = legacyTask.id;
			const rawFilePath = legacyTask.path;

			if ((typeof rawTaskId !== 'string' && typeof rawTaskId !== 'number') || typeof rawFilePath !== 'string') {
				continue;
			}

			const taskId = String(rawTaskId).trim();
			const filePath = rawFilePath.trim();
			if (!taskId || !filePath || migrated[taskId]) continue;

			const entry: TaskMappingEntry = {
				filePath,
				syncEnabled: true,
				status: legacyTask.isCompleted === true ? 'nonActive' : 'active',
			};

			if (typeof legacyTask.updated_at === 'string') {
				entry.updated_at = legacyTask.updated_at;
			} else if (typeof legacyTask.updatedAt === 'string') {
				entry.updated_at = legacyTask.updatedAt;
			}

			migrated[taskId] = entry;
		}

		return migrated;
	}

	async save(): Promise<boolean> {
		this.cancelDebouncedSave();

		return this.withSettingsIOLock('save', async () => {
			const settingsPath = this.plugin.storagePathManager!.settingsFilePath;
			const tempPath = this.plugin.storagePathManager!.settingsTempFilePath;

			try {
				if (!this.plugin.settings || Object.keys(this.plugin.settings).length === 0) {
					console.error('[Settings] Settings are empty or invalid, not saving to avoid data loss.');
					return false;
				}

				if (!this.validate(this.plugin.settings)) {
					console.error('[Settings] Settings validation failed');
					return false;
				}

				const settingsJson = this.buildSettingsSnapshot();
				const adapter = this.plugin.app.vault.adapter;
				const settingsExists = await adapter.exists(settingsPath);

				if (!this.hasDirtyChanges && settingsExists && settingsJson === this.lastSavedSnapshot) {
					this.plugin.debugLog('[Settings] No changes detected, skipping save');
					return true;
				}

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

				this.markPersisted(settingsJson);
				this.plugin.debugLog('[Settings] Settings saved successfully');
				return true;
			} catch (error) {
				console.error('[Settings] Error saving settings:', error);
				new Notice('Settings save failed, temp file preserved for recovery');
				return false;
			}
		});
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

	private stripUnknownFields(): void {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		let stripped = 0;
		for (const key of Object.keys(settings)) {
			if (!KNOWN_SETTINGS_KEYS.has(key)) {
				this.plugin.debugLog(`[Settings] Stripping unknown field: ${key}`);
				delete settings[key];
				stripped++;
			}
		}
		if (stripped > 0) this.plugin.debugLog(`[Settings] Stripped ${stripped} unknown field(s) from loaded data`);
	}

	private sanitizeTaskFileMapping(): void {
		const mapping = this.plugin.settings.taskFileMapping;
		if (!mapping) return;
		let fixed = 0;
		const validStates = new Set(['open', 'resolved', 'ignored']);
		const validSeverity = new Set(['low', 'medium', 'high']);
		const validSource = new Set(['database_checker', 'runtime']);
		for (const [taskId, entry] of Object.entries(mapping)) {
			// Remove entries with missing or invalid filePath
			if (!entry || typeof entry.filePath !== 'string' || !entry.filePath.trim()) {
				this.plugin.debugLog(`[Settings] Removing malformed mapping entry: ${taskId}`);
				delete mapping[taskId];
				fixed++;
				continue;
			}
			let normalizedIssues: Record<string, TaskIssueEntry> | undefined;
			if (entry.issues && typeof entry.issues === 'object' && !Array.isArray(entry.issues)) {
				normalizedIssues = {};
				for (const [issueType, issueValue] of Object.entries(entry.issues)) {
					if (!issueValue || typeof issueValue !== 'object' || Array.isArray(issueValue)) {
						fixed++;
						continue;
					}

					const candidate = issueValue as Partial<TaskIssueEntry>;
					const state = validStates.has(candidate.state as string) ? candidate.state as TaskIssueEntry['state'] : 'open';
					const severity = validSeverity.has(candidate.severity as string) ? candidate.severity as TaskIssueEntry['severity'] : 'medium';
					const source = validSource.has(candidate.source as string) ? candidate.source as TaskIssueEntry['source'] : 'runtime';
					const detectedAt = typeof candidate.detectedAt === 'number' ? candidate.detectedAt : Date.now();
					const lastSeenAt = typeof candidate.lastSeenAt === 'number' ? candidate.lastSeenAt : detectedAt;

					const normalizedIssueType = normalizeTaskIssueTypeKey(issueType);
					normalizedIssues[normalizedIssueType] = {
						state,
						severity,
						source,
						detectedAt,
						lastSeenAt,
						details: typeof candidate.details === 'string' ? candidate.details : undefined,
						expected: typeof candidate.expected === 'string' ? candidate.expected : undefined,
						actual: typeof candidate.actual === 'string' ? candidate.actual : undefined,
						manualAction: typeof candidate.manualAction === 'string' ? candidate.manualAction : undefined,
					};
				}
			}

			if (normalizedIssues && Object.keys(normalizedIssues).length > 0) {
				entry.issues = normalizedIssues;
			} else if (entry.issues !== undefined) {
				delete entry.issues;
				fixed++;
			}

			const reconciled = reconcileTaskEntryDerivedState(entry as {
				status?: 'active' | 'nonActive' | 'conflicted' | 'issue';
				syncEnabled?: boolean;
				issues?: Record<string, TaskIssueEntry>;
			});
			if (reconciled.changed) {
				fixed++;
			}
		}
		if (fixed > 0) this.plugin.debugLog(`[Settings] Sanitized ${fixed} corrupted taskFileMapping entry(s)`);
	}


	private async runMigrations(rawData: Record<string, unknown>): Promise<void> {
		const fromVersion = typeof rawData.schemaVersion === 'number' ? rawData.schemaVersion : 0;
		if (fromVersion >= CURRENT_SCHEMA_VERSION) return;

		console.log(`[Settings] Running migrations from schema v${fromVersion} to v${CURRENT_SCHEMA_VERSION}`);

		// Force backup before first migration
		try {
			await this.plugin.settingsBackup?.backup();
		} catch (backupError) {
			console.warn('[Settings] Pre-migration backup failed:', backupError);
		}

		// v0 → v1: Migrate isPrimaryDevice boolean to primaryDeviceId string
		if (fromVersion < 1) {
			const legacyIsPrimary = rawData.isPrimaryDevice;
			if (legacyIsPrimary === true && !this.plugin.settings.primaryDeviceId) {
				try {
					const tempDeviceManager = new DeviceManager(this.plugin.app, this.plugin);
					const deviceId = await tempDeviceManager.getDeviceId();
					this.plugin.settings.primaryDeviceId = deviceId;
					this.plugin.debugLog('[Settings] v0→v1: Migrated isPrimaryDevice to primaryDeviceId:', deviceId);
				} catch (error) {
					console.error('[Settings] v0→v1: Failed to migrate isPrimaryDevice:', error);
				}
			}
		}

		// Stamp current version and persist
		this.plugin.settings.schemaVersion = CURRENT_SCHEMA_VERSION;
		this.markDirty();
		await this.save();
		console.log(`[Settings] Migration complete — now at schema v${CURRENT_SCHEMA_VERSION}`);
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
			this.markDirty();
			if (shouldSave) {
				await this.save();
			} else {
				this.scheduleDebouncedSave();
			}
		} catch (error) {
			console.error('[SafeSettings] Update failed:', error);
			if (this.plugin.settingsBackup) {
				const restored = await this.plugin.settingsBackup.restore();
				if (restored) {
					await this.reloadSettingsFromDisk();
				}
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
			this.markDirty();
			await this.save();
		} catch (error) {
			console.error('[SafeSettings] Reset failed:', error);
			if (this.plugin.settingsBackup) {
				const restored = await this.plugin.settingsBackup.restore();
				if (restored) {
					await this.reloadSettingsFromDisk();
				}
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

	private async withSettingsIOLock<T>(operation: string, fn: () => Promise<T>): Promise<T> {
		if (this.plugin.safeSettings) {
			return this.plugin.safeSettings.withSettingsIOLock(`settings-backup:${operation}`, fn);
		}
		return fn();
	}

	private getBackupDirsToSearch(): string[] {
		const dirs: string[] = [];

		if (this.plugin.storagePathManager) {
			dirs.push(this.plugin.storagePathManager.getBackupsSettingsPath());
		}

		const configuredDir = this.plugin.settings?.storageDirectory;
		if (configuredDir) {
			dirs.push(`${configuredDir}/backups/settings`);
		}

		const lastDir = this.plugin.settings?.lastStorageDirectory;
		if (lastDir) {
			dirs.push(`${lastDir}/backups/settings`);
		}

		dirs.push(`${StoragePathManager.DEFAULT_BASE_PATH}/backups/settings`);
		dirs.push(`${StoragePathManager.LEGACY_BASE_PATH}/backups/settings`);

		return Array.from(new Set(dirs));
	}

	private getSortedBackupFiles(): string[] {
		const searchDirs = this.getBackupDirsToSearch();
		const files = this.app.vault.getFiles()
			.filter(file =>
				searchDirs.some(dir => file.path.startsWith(dir + '/'))
				&& file.name.startsWith('settings-')
				&& file.name.endsWith('.json')
			)
			.sort((a, b) => b.stat.mtime - a.stat.mtime);

		return files.map(file => file.path);
	}

	private getBackupDir(): string {
		if (this.plugin.storagePathManager) {
			return this.plugin.storagePathManager.getBackupsSettingsPath();
		}
		const dir = this.plugin.settings?.storageDirectory || StoragePathManager.DEFAULT_BASE_PATH;
		return `${dir}/backups/settings`;
	}

	private async ensureBackupDir(): Promise<void> {
		const dir = this.getBackupDir();
		if (this.plugin.storagePathManager) {
			await this.plugin.storagePathManager.ensureDir(dir);
		} else {
			const adapter = this.app.vault.adapter;
			if (!await adapter.exists(dir)) {
				await adapter.mkdir(dir);
			}
		}
	}

	async backup(): Promise<boolean> {
		return this.withSettingsIOLock('backup', async () => {
			try {
				await this.ensureBackupDir();
				const settingsPath = this.plugin.storagePathManager!.settingsFilePath;
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
				this.plugin.debugLog('[SettingsBackup] Backup created:', backupPath);
				await this.cleanOldBackups();
				return true;
			} catch (error) {
				console.error('[SettingsBackup] Backup failed:', error);
				return false;
			}
		});
	}

	async restore(): Promise<boolean> {
		return this.withSettingsIOLock('restore', async () => {
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
				const settingsPath = this.plugin.storagePathManager!.settingsFilePath;
				const tempPath = this.plugin.storagePathManager!.settingsTempFilePath;
				await adapter.write(tempPath, data);
				await adapter.write(settingsPath, data);
				await adapter.remove(tempPath).catch(() => {});
				this.plugin.debugLog('[SettingsBackup] Settings restored from:', latestBackup);
				new Notice('Settings restored from backup');
				return true;
			} catch (error) {
				console.error('[SettingsBackup] Restore failed:', error);
				new Notice('Failed to restore settings from backup');
				return false;
			}
		});
	}

	async getLatestBackup(): Promise<string | null> {
		try {
			const files = this.getSortedBackupFiles();
			return files[0] ?? null;
		} catch (error) {
			console.error('[SettingsBackup] Failed to get latest backup:', error);
			return null;
		}
	}

	async getBackupList(): Promise<string[]> {
		try {
			return this.getSortedBackupFiles();
		} catch (error) {
			console.error('[SettingsBackup] Failed to get backup list:', error);
			return [];
		}
	}

	async restoreFromSpecific(backupPath: string): Promise<boolean> {
		return this.withSettingsIOLock('restore-from-specific', async () => {
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
				const settingsPath = this.plugin.storagePathManager!.settingsFilePath;
				const tempPath = this.plugin.storagePathManager!.settingsTempFilePath;
				await adapter.write(tempPath, data);
				await adapter.write(settingsPath, data);
				await adapter.remove(tempPath).catch(() => {});
				this.plugin.debugLog('[SettingsBackup] Settings restored from specific backup:', backupPath);
				new Notice('Settings restored from backup');
				return true;
			} catch (error) {
				console.error('[SettingsBackup] Restore from specific failed:', error);
				new Notice('Failed to restore settings from backup');
				return false;
			}
		});
	}

	async recoverFromTempFile(): Promise<boolean> {
		return this.withSettingsIOLock('recover-temp', async () => {
			try {
				const tempPath = this.plugin.storagePathManager!.settingsTempFilePath;
				const settingsPath = this.plugin.storagePathManager!.settingsFilePath;
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
				// Atomic: write temp copy → write actual → remove temp copy
				const recoveryTempPath = settingsPath + '.recovery.tmp';
				await adapter.write(recoveryTempPath, data);
				await adapter.write(settingsPath, data);
				await adapter.remove(recoveryTempPath).catch(() => {});
				await adapter.remove(tempPath).catch(() => {});
				this.plugin.debugLog('[SettingsBackup] Recovered from temp file');
				new Notice('Settings recovered from temp file');
				return true;
			} catch (error) {
				console.error('[SettingsBackup] Failed to recover from temp file:', error);
				return false;
			}
		});
	}

	async hasTempFile(): Promise<boolean> {
		return this.app.vault.adapter.exists(this.plugin.storagePathManager!.settingsTempFilePath);
	}

	async clearAllBackups(): Promise<boolean> {
		try {
			const backupDir = this.getBackupDir();
			const adapter = this.app.vault.adapter;
			if (await adapter.exists(backupDir)) {
				await adapter.rmdir(backupDir, true);
				this.plugin.debugLog('[SettingsBackup] All backups cleared');
			}
			return true;
		} catch (error) {
			console.error('[SettingsBackup] Failed to clear backups:', error);
			return false;
		}
	}

	private async cleanOldBackups(): Promise<void> {
		try {
			const files = this.getSortedBackupFiles();
			if (files.length > this.maxBackups) {
				const adapter = this.app.vault.adapter;
				for (const filePath of files.slice(this.maxBackups)) {
					try {
						if (await adapter.exists(filePath)) await adapter.remove(filePath);
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
