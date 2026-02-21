import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import UltimateTodoistSyncForObsidian from "../main";
import { LogAction } from './logOperation';

export interface UltimateTodoistSyncSettings {
    initialized: boolean;
    todoistAPIToken: string;
    apiInitialized: boolean;
    defaultProjectName: string;
    defaultProjectId: string;
    automaticSynchronizationInterval: number;
    fileMetadata: Record<string, { defaultProjectId?: string }>;
    taskFileMapping: {
        [taskId: string]: {
            filePath: string;
            lineNumber: number;
            status?: 'active' | 'nonActive' | 'conflicted' | 'issue';
            syncEnabled?: boolean;
        };
    };
    enableFullVaultSync: boolean;
    statistics: Record<string, any>;
    debugMode: boolean;
    useAppURI: boolean;
    syncEnabled: boolean;
    obsidianToTodoistEnabled: boolean;
    todoistToObsidianEnabled: boolean;
    lastDatabaseCheckPassed: boolean;
    lastDatabaseCheckTime: number | null;
    syncDataCache: Record<string, any> | null;
    deviceIdGenerated: boolean;
    enableLog: boolean;
    logs: Array<{
        timestamp: number;
        action: LogAction;
        details: string;
        filePath?: string;
        taskId?: string;
    }>;
    logFileEnabled: boolean;
    logRetentionDays: number;
    maxBackupsPerFile: number;
    storageDirectory: string;
    lastStorageDirectory: string | null;
}

export const DEFAULT_SETTINGS: UltimateTodoistSyncSettings = {
    initialized: false,
    apiInitialized: false,
    todoistAPIToken: '',
    defaultProjectName: "Inbox",
    defaultProjectId: "",
    automaticSynchronizationInterval: 300,
    fileMetadata: {},
    taskFileMapping: {},
    enableFullVaultSync: false,
    statistics: {},
    debugMode: false,
    useAppURI: true,
    syncEnabled: false,
    obsidianToTodoistEnabled: true,
    todoistToObsidianEnabled: false,
    lastDatabaseCheckPassed: false,
    lastDatabaseCheckTime: null,
    syncDataCache: null,
    deviceIdGenerated: false,
    enableLog: true,
    logs: [],
    logFileEnabled: true,
    logRetentionDays: 365,
    maxBackupsPerFile: 100,
    storageDirectory: 'ultimate-todoist-sync',
    lastStorageDirectory: null,
}

export class UltimateTodoistSyncSettingTab extends PluginSettingTab {
    plugin: UltimateTodoistSyncForObsidian;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Ultimate Todoist Sync Settings' });

        // ============================================
        // API Configuration Section
        // ============================================
        containerEl.createEl('h3', { text: 'API Configuration' });

        new Setting(containerEl)
            .setName('Todoist API Token')
            .setDesc('Enter your Todoist API token and click the send button to connect.')
            .addText((text) =>
                text
                    .setPlaceholder('Enter your API token')
                    .setValue(this.plugin.settings.todoistAPIToken)
                    .onChange(async (value) => {
                        this.plugin.settings.todoistAPIToken = value;
                        this.plugin.settings.apiInitialized = false;
                    })
            )
            .addExtraButton((button) => {
                button.setIcon('send')
                    .onClick(async () => {
                        await this.plugin.modifyTodoistAPI(this.plugin.settings.todoistAPIToken)
                        this.display()
                    })
            });

        // ============================================
        // Sync Settings Section
        // ============================================
        containerEl.createEl('h3', { text: 'Sync Settings' });

        new Setting(containerEl)
            .setName('Automatic Sync Interval')
            .setDesc('Time in seconds between automatic syncs. Default: 300 (5 minutes). Minimum: 20 seconds.')
            .addText((text) =>
                text
                    .setPlaceholder('300')
                    .setValue(this.plugin.settings.automaticSynchronizationInterval.toString())
                    .onChange(async (value) => {
                        const intervalNum = Number(value)
                        if (isNaN(intervalNum)) {
                            new Notice(`Please enter a valid number.`)
                            return
                        }
                        if (intervalNum < 20) {
                            new Notice(`Minimum interval is 20 seconds.`)
                            return
                        }
                        if (!Number.isInteger(intervalNum)) {
                            new Notice('Please enter an integer.');
                            return;
                        }
                        this.plugin.settings.automaticSynchronizationInterval = intervalNum;
                        this.plugin.saveSettings()
                        new Notice('Sync interval updated.');
                    })
            );

        const myProjectsOptions: Record<string, string> = {};

        new Setting(containerEl)
            .setName('Default Project')
            .setDesc('New tasks will be created in this project.')
            .addDropdown(component =>
                component
                    .addOption(this.plugin.settings.defaultProjectId, this.plugin.settings.defaultProjectName)
                    .addOptions(myProjectsOptions)
                    .onChange((value) => {
                        this.plugin.settings.defaultProjectId = value
                        const project = this.plugin.todoistSyncAPI?.getSyncData()?.projects?.find((p: any) => p.id === value);
                        this.plugin.settings.defaultProjectName = project?.name || value;
                        this.plugin.saveSettings()
                    })
            );

        new Setting(containerEl)
            .setName('Full Vault Sync')
            .setDesc('Sync all tasks in vault, not just those with #todoist tag.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.enableFullVaultSync)
                    .onChange((value) => {
                        this.plugin.settings.enableFullVaultSync = value
                        this.plugin.saveSettings()
                        new Notice(`Full vault sync ${value ? 'enabled' : 'disabled'}.`)
                    })
            );

        new Setting(containerEl)
            .setName('Use Desktop URIs')
            .setDesc('Open Todoist tasks in desktop app (todoist://) instead of browser (https://).')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.useAppURI)
                    .onChange((value) => {
                        this.plugin.settings.useAppURI = value
                        this.plugin.saveSettings()
                    })
            );

        // ============================================
        // Sync Direction Control Section
        // ============================================
        containerEl.createEl('h3', { text: 'Sync Direction' });

        const syncStatusEl = containerEl.createEl('div', { cls: 'setting-item-description' });
        const updateSyncStatus = () => {
            const passed = this.plugin.settings.lastDatabaseCheckPassed;
            const mainEnabled = this.plugin.settings.syncEnabled;
            const o2tEnabled = this.plugin.settings.obsidianToTodoistEnabled;
            const t2oEnabled = this.plugin.settings.todoistToObsidianEnabled;
            const lastCheck = this.plugin.settings.lastDatabaseCheckTime
                ? new Date(this.plugin.settings.lastDatabaseCheckTime).toLocaleString()
                : 'Never';

            let statusText = '';
            if (!passed) {
                statusText = '⚠️ Blocked - database issues detected';
            } else if (!mainEnabled) {
                statusText = '❌ Disabled';
            } else {
                const o2t = o2tEnabled ? '✅' : '❌';
                const t2o = t2oEnabled ? '✅' : '❌';
                statusText = `✅ Enabled (O→T: ${o2t}, T→O: ${t2o})`;
            }

            syncStatusEl.innerHTML = `
                <div style="margin-bottom: 8px;"><strong>Status:</strong> ${statusText}</div>
                <div><strong>Last Check:</strong> ${lastCheck}</div>
            `;
        };
        updateSyncStatus();

        new Setting(containerEl)
            .setName('Enable Sync')
            .setDesc('Master switch for all synchronization.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.syncEnabled)
                    .onChange(async (value) => {
                        this.plugin.settings.syncEnabled = value;
                        await this.plugin.saveSettings();
                        updateSyncStatus();
                        new Notice(`Sync ${value ? 'enabled' : 'disabled'}`);
                    })
            );

        new Setting(containerEl)
            .setName('Obsidian → Todoist')
            .setDesc('Push changes from Obsidian to Todoist.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.obsidianToTodoistEnabled)
                    .onChange(async (value) => {
                        this.plugin.settings.obsidianToTodoistEnabled = value;
                        await this.plugin.saveSettings();
                        updateSyncStatus();
                        new Notice(`Obsidian → Todoist ${value ? 'enabled' : 'disabled'}`);
                    })
            );

        new Setting(containerEl)
            .setName('Todoist → Obsidian')
            .setDesc('Pull changes from Todoist to Obsidian.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.todoistToObsidianEnabled)
                    .onChange(async (value) => {
                        this.plugin.settings.todoistToObsidianEnabled = value;
                        await this.plugin.saveSettings();
                        updateSyncStatus();
                        new Notice(`Todoist → Obsidian ${value ? 'enabled' : 'disabled'}`);
                    })
            );

        // ============================================
        // Tools Section
        // ============================================
        containerEl.createEl('h3', { text: 'Tools' });

        new Setting(containerEl)
            .setName('Manual Sync')
            .setDesc('Manually trigger a sync now.')
            .addButton(button => button
                .setButtonText('Sync Now')
                .onClick(async () => {
                    if (!this.plugin.settings.apiInitialized) {
                        new Notice('Please set the Todoist API first')
                        return
                    }
                    try {
                        await this.plugin.scheduledSynchronization()
                        this.plugin.syncLock = false
                        new Notice('Sync completed.')
                    } catch (error) {
                        new Notice(`Sync error: ${error}`)
                        this.plugin.syncLock = false;
                    }
                })
            );

        new Setting(containerEl)
            .setName('Rebuild Cache')
            .setDesc('Scan vault and Todoist to rebuild task cache. Use when cache is corrupted.')
            .addButton(button => button
                .setButtonText('Rebuild')
                .onClick(async () => {
                    if (!this.plugin.settings.apiInitialized) {
                        new Notice('Please set the Todoist API first')
                        return
                    }

                    const rebuildNotice = new Notice('Starting cache rebuild...', 0);

                    try {
                        const result = await this.plugin.cacheOperation.rebuildCache((message: string) => {
                            rebuildNotice.setMessage(message);
                        });

                        if (result.success) {
                            new Notice(`Cache rebuilt! ${result.tasksProcessed} tasks processed.`);
                        } else {
                            new Notice('Cache rebuild failed!');
                        }
                    } catch (error) {
                        new Notice(`Rebuild error: ${error.message}`);
                    }
                })
            );

        new Setting(containerEl)
            .setName('Check Database')
            .setDesc('Check for sync issues, conflicts, and data inconsistencies.')
            .addButton(button => button
                .setButtonText('Check')
                .onClick(async () => {
                    if (!this.plugin.settings.apiInitialized) {
                        new Notice('Please set the Todoist API first')
                        return
                    }

                    const checkNotice = new Notice('Checking database...', 0);

                    try {
                        const result = await this.plugin.databaseChecker!.checkDatabase((message: string) => {
                            checkNotice.setMessage(message);
                        });

                        checkNotice.hide();
                        this.plugin.settings.lastDatabaseCheckTime = Date.now();

                        if (result.success) {
                            this.plugin.settings.lastDatabaseCheckPassed = true;
                            this.plugin.settings.syncEnabled = true;
                            await this.plugin.saveSettings();
                            updateSyncStatus();
                            new Notice('✅ Database check passed! No issues found.');
                        } else {
                            this.plugin.settings.lastDatabaseCheckPassed = false;
                            this.plugin.settings.syncEnabled = false;
                            await this.plugin.saveSettings();
                            updateSyncStatus();
                            new Notice(`⚠️ Found ${result.totalIssues} issues. Sync disabled.`);
                        }

                        if (result.reportPath) {
                            new Notice(`Report: ${result.reportPath}`, 5000);
                        }
                    } catch (error) {
                        checkNotice.hide();
                        new Notice(`Check failed: ${error.message}`);
                    }
                })
            );

        new Setting(containerEl)
            .setName('Fix & Enable Sync')
            .setDesc('Run database check and auto-enable sync if no issues.')
            .addButton(button => button
                .setButtonText('Fix & Enable')
                .onClick(async () => {
                    if (!this.plugin.settings.apiInitialized) {
                        new Notice('Please set the Todoist API first')
                        return
                    }
                    if (!this.plugin.databaseChecker) {
                        new Notice('Database checker not initialized')
                        return
                    }

                    const checkNotice = new Notice('Running database check...', 0);
                    try {
                        const result = await this.plugin.databaseChecker.checkDatabase();
                        checkNotice.hide();

                        this.plugin.settings.lastDatabaseCheckTime = Date.now();

                        if (result.success) {
                            this.plugin.settings.lastDatabaseCheckPassed = true;
                            this.plugin.settings.syncEnabled = true;
                            await this.plugin.saveSettings();
                            updateSyncStatus();
                            new Notice('✅ Issues fixed! Sync enabled.');
                        } else {
                            this.plugin.settings.lastDatabaseCheckPassed = false;
                            this.plugin.settings.syncEnabled = false;
                            await this.plugin.saveSettings();
                            updateSyncStatus();
                            new Notice(`⚠️ Found ${result.totalIssues} issues. Please fix manually.`);
                        }
                    } catch (error) {
                        checkNotice.hide();
                        new Notice(`Error: ${error.message}`);
                    }
                })
            );

        // ============================================
        // Logs & Debug Section
        // ============================================
        containerEl.createEl('h3', { text: 'Logs & Debug' });

        new Setting(containerEl)
            .setName('Enable Logging')
            .setDesc('Log file modifications and sync operations.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.enableLog)
                    .onChange((value) => {
                        this.plugin.settings.enableLog = value
                        this.plugin.saveSettings()
                    })
            );

        new Setting(containerEl)
            .setName('Debug Mode')
            .setDesc('Output detailed logs to console for troubleshooting.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.debugMode)
                    .onChange((value) => {
                        this.plugin.settings.debugMode = value
                        this.plugin.saveSettings()
                    })
            );

        new Setting(containerEl)
            .setName('View Logs')
            .setDesc('View operation logs.')
            .addButton(button => button
                .setButtonText('View')
                .onClick(() => {
                    const logsText = this.plugin.logOperation?.getLogsAsText() || 'No logs.';
                    new Notice(logsText, 10000);
                })
            );

        new Setting(containerEl)
            .setName('Clear Logs')
            .setDesc('Clear all operation logs.')
            .addButton(button => button
                .setButtonText('Clear')
                .onClick(() => {
                    this.plugin.logOperation?.clearLogs();
                    new Notice('Logs cleared.');
                })
            );

        // ============================================
        // Backup & Recovery Section
        // ============================================
        containerEl.createEl('h3', { text: 'Backup & Recovery' });

        new Setting(containerEl)
            .setName('Storage Directory')
            .setDesc('Directory for plugin data storage. Changing this will migrate existing data.')
            .addText(text => text
                .setPlaceholder('ultimate-todoist-sync')
                .setValue(this.plugin.settings.storageDirectory)
                .onChange(async (value) => {
                    const newDir = value.trim();
                    const currentDir = this.plugin.settings.storageDirectory;
                    
                    if (!newDir) {
                        new Notice('Directory name cannot be empty');
                        return;
                    }
                    
                    if (newDir === currentDir) return;
                    
                    const confirmed = confirm(
                        `Change storage directory from "${currentDir}" to "${newDir}"?\n\n` +
                        'Existing data will be migrated to the new location.'
                    );
                    if (!confirmed) return;
                    
                    if (this.plugin.storagePathManager) {
                        const success = await this.plugin.storagePathManager.migrateToNewDirectory(newDir);
                        if (success) {
                            this.plugin.settings.storageDirectory = newDir;
                            await this.plugin.saveSettings();
                            new Notice('Storage directory changed. Please reload the plugin.');
                        } else {
                            new Notice('Migration failed. Check console for details.');
                        }
                    } else {
                        this.plugin.settings.storageDirectory = newDir;
                        await this.plugin.saveSettings();
                        new Notice('Storage directory updated. Please reload the plugin.');
                    }
                })
            );

        new Setting(containerEl)
            .setName('Backup Todoist Data')
            .setDesc('Backup all Todoist data to vault.')
            .addButton(button => button
                .setButtonText('Backup')
                .onClick(() => {
                    if (!this.plugin.settings.apiInitialized) {
                        new Notice('Please set the Todoist API first')
                        return
                    }
                    this.plugin.todoistSync.backupTodoistAllResources()
                })
            );

        new Setting(containerEl)
            .setName('Backup Settings')
            .setDesc('Manually backup current settings.')
            .addButton(button => button
                .setButtonText('Backup')
                .onClick(async () => {
                    if (!this.plugin.settingsBackup) {
                        new Notice('Settings backup not initialized')
                        return;
                    }
                    const success = await this.plugin.settingsBackup.backup();
                    new Notice(success ? 'Settings backed up.' : 'Backup failed.');
                })
            );

        new Setting(containerEl)
            .setName('Restore Settings')
            .setDesc('Restore settings from latest backup.')
            .addButton(button => button
                .setButtonText('Restore')
                .onClick(async () => {
                    if (!this.plugin.settingsBackup) {
                        new Notice('Settings backup not initialized')
                        return;
                    }
                    const success = await this.plugin.settingsBackup.restore();
                    if (success) {
                        new Notice('Settings restored. Please reload the plugin.');
                    }
                })
            );

        new Setting(containerEl)
            .setName('View Backup History')
            .setDesc('View available settings backups.')
            .addButton(button => button
                .setButtonText('View')
                .onClick(async () => {
                    if (!this.plugin.settingsBackup) {
                        new Notice('Not initialized')
                        return;
                    }
                    const backups = await this.plugin.settingsBackup.getBackupList();
                    if (backups.length === 0) {
                        new Notice('No backups found');
                        return;
                    }
                    let msg = 'Backups:\n';
                    backups.slice(0, 5).forEach((b, i) => {
                        msg += `${i + 1}. ${b.split('/').pop()}\n`;
                    });
                    new Notice(msg, 8000);
                })
            );

        new Setting(containerEl)
            .setName('Reset Settings')
            .setDesc('Reset all settings to defaults. WARNING: Will lose all task mappings!')
            .addButton(button => {
                button.setButtonText('Reset');
                button.setWarning();
                button.onClick(async () => {
                    const confirmed = confirm('Reset ALL settings to defaults? All task mappings will be lost!');
                    if (!confirmed) return;

                    this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
                    await this.plugin.saveSettings();
                    new Notice('Settings reset. Please reload the plugin.');
                });
            });
    }
}
