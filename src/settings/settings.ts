import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import UltimateTodoistSyncForObsidian from "../../main";

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
            updated_at?: string;
            note_count?: number;
        };
    };
    enableFullVaultSync: boolean;
    debugMode: boolean;
    useAppURI: boolean;
    syncEnabled: boolean;
    obsidianToTodoistEnabled: boolean;
    todoistToObsidianEnabled: boolean;
    lastDatabaseCheckPassed: boolean;
    lastDatabaseCheckTime: number | null;
    syncDataCache: Record<string, any> | null;
    enableLog: boolean;
    logFileEnabled: boolean;
    maxLogFileSize: number;
    logRetentionPercent: number;
    maxBackupsPerFile: number;
    storageDirectory: string;
    lastStorageDirectory: string | null;
    conflictResolutionStrategy: 'todoist-wins' | 'obsidian-wins' | 'manual';
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
    debugMode: false,
    useAppURI: true,
    syncEnabled: false,
    obsidianToTodoistEnabled: true,
    todoistToObsidianEnabled: false,
    lastDatabaseCheckPassed: false,
    lastDatabaseCheckTime: null,
    syncDataCache: null,
    enableLog: true,
    logFileEnabled: true,
    maxLogFileSize: 1024 * 1024,
    logRetentionPercent: 80,
    maxBackupsPerFile: 100,
    storageDirectory: 'ultimate-todoist-sync',
    lastStorageDirectory: null,
    conflictResolutionStrategy: 'manual',
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
                        await this.plugin.safeSettings?.update({ todoistAPIToken: value, apiInitialized: false });
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
                        await this.plugin.safeSettings?.update({ automaticSynchronizationInterval: intervalNum }, true)
                        new Notice('Sync interval updated.');
                    })
            );

        const myProjectsOptions: Record<string, string> = {};
        const projects = this.plugin.todoistSyncAPI?.getSyncData()?.projects || [];
        for (const p of projects) {
            myProjectsOptions[p.id] = p.name;
        }

        new Setting(containerEl)
            .setName('Default Project')
            .setDesc('New tasks will be created in this project.')
            .addDropdown(component =>
                component
                    .addOption(this.plugin.settings.defaultProjectId, this.plugin.settings.defaultProjectName)
                    .addOptions(myProjectsOptions)
                    .onChange(async (value) => {
                        const project = projects.find((p: any) => p.id === value);
                        await this.plugin.safeSettings?.update({
                            defaultProjectId: value,
                            defaultProjectName: project?.name || value
                        }, true)
                    })
            );

        new Setting(containerEl)
            .setName('Full Vault Sync')
            .setDesc('Sync all tasks in vault, not just those with #todoist tag.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.enableFullVaultSync)
                    .onChange(async (value) => {
                        await this.plugin.safeSettings?.update({ enableFullVaultSync: value }, true)
                        new Notice(`Full vault sync ${value ? 'enabled' : 'disabled'}.`)
                    })
            );

        new Setting(containerEl)
            .setName('Use Desktop URIs')
            .setDesc('Open Todoist tasks in desktop app (todoist://) instead of browser (https://).')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.useAppURI)
                    .onChange(async (value) => {
                        await this.plugin.safeSettings?.update({ useAppURI: value }, true)
                    })
            );

        new Setting(containerEl)
            .setName('Conflict Resolution Strategy')
            .setDesc('When a task is modified in both Obsidian and Todoist: todoist-wins overwrites Obsidian, obsidian-wins pushes Obsidian to Todoist, manual disables sync until resolved.')
            .addDropdown(component =>
                component
                    .addOption('manual', 'Manual (disable sync until resolved)')
                    .addOption('todoist-wins', 'Todoist wins (overwrite Obsidian)')
                    .addOption('obsidian-wins', 'Obsidian wins (overwrite Todoist)')
                    .setValue(this.plugin.settings.conflictResolutionStrategy)
                    .onChange(async (value: 'todoist-wins' | 'obsidian-wins' | 'manual') => {
                        await this.plugin.safeSettings?.update({ conflictResolutionStrategy: value }, true);
                        new Notice(`Conflict strategy set to: ${value}`);
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

            let statusText = '';
            if (!mainEnabled) {
                statusText = '❌ Disabled';
            } else {
                const o2t = o2tEnabled ? '✅' : '❌';
                const t2o = t2oEnabled ? '✅' : '❌';
                statusText = `✅ Enabled (O→T: ${o2t}, T→O: ${t2o})`;
            }
            if (!passed) {
                statusText += ' ⚠️ (database issues detected — some tasks may be skipped)';
            }

            syncStatusEl.innerHTML = `<div><strong>Status:</strong> ${statusText}</div>`;
        };
        updateSyncStatus();

        new Setting(containerEl)
            .setName('Enable Sync')
            .setDesc('Master switch for all synchronization.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.syncEnabled)
                    .onChange(async (value) => {
                        await this.plugin.safeSettings?.update({ syncEnabled: value }, true);
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
                        await this.plugin.safeSettings?.update({ obsidianToTodoistEnabled: value }, true);
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
                        await this.plugin.safeSettings?.update({ todoistToObsidianEnabled: value }, true);
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
                        await this.plugin.scheduler.run()
                        new Notice('Sync completed.')
                    } catch (error) {
                        new Notice(`Sync error: ${error}`)
                    }
                })
            );

        const checkStatusEl = containerEl.createEl('div', { cls: 'setting-item-description' });
        const updateCheckStatus = () => {
            const lastCheck = this.plugin.settings.lastDatabaseCheckTime
                ? new Date(this.plugin.settings.lastDatabaseCheckTime).toLocaleString()
                : 'Never';
            checkStatusEl.innerHTML = `<div><strong>Last Check:</strong> ${lastCheck}</div>`;
        };
        updateCheckStatus();

        new Setting(containerEl)
            .setName('Fix Database')
            .setDesc('Check for inconsistencies, auto-fix what can be fixed (missing mappings, orphan records), then report what was fixed and what still needs manual attention.')
            .addButton(button => button
                .setButtonText('Fix Database')
                .onClick(async () => {
                    if (!this.plugin.settings.apiInitialized) {
                        new Notice('Please set the Todoist API first');
                        return;
                    }
                    if (!this.plugin.databaseChecker) {
                        new Notice('Database checker not initialized');
                        return;
                    }
                    const progressNotice = new Notice('Step 1/3: Checking database...', 0);
                    try {
                        // Step 1: Initial check
                        const before = await this.plugin.databaseChecker.checkDatabase((msg) => {
                            progressNotice.setMessage(`Step 1/3: ${msg}`);
                        });
                        if (before.success) {
                            progressNotice.hide();
                            await this.plugin.safeSettings?.update({
                                lastDatabaseCheckTime: Date.now(),
                                lastDatabaseCheckPassed: true
                            }, true);
                            updateSyncStatus();
                            updateCheckStatus();
                            new Notice('✅ Database is healthy.');
                            return;
                        }
                        // Step 2: Rebuild cache to fix what can be fixed
                        progressNotice.setMessage(`Step 2/3: Found ${before.totalIssues} issues. Rebuilding cache...`);
                        await this.plugin.cacheOperation.rebuildCache((msg) => {
                            progressNotice.setMessage(`Step 2/3: ${msg}`);
                        });
                        // Step 3: Re-check to see what remains
                        progressNotice.setMessage('Step 3/3: Re-checking database...');
                        const after = await this.plugin.databaseChecker.checkDatabase((msg) => {
                            progressNotice.setMessage(`Step 3/3: ${msg}`);
                        });
                        progressNotice.hide();
                        const fixedCount = Math.max(0, before.totalIssues - after.totalIssues);
                        const remainingCount = after.totalIssues;
                        await this.plugin.safeSettings?.update({
                            lastDatabaseCheckTime: Date.now(),
                            lastDatabaseCheckPassed: after.success
                        }, true);
                        updateSyncStatus();
                        updateCheckStatus();
                        if (after.success) {
                            new Notice(`✅ Fixed ${fixedCount} issues. Database is healthy.`);
                        } else {
                            new Notice(
                                `⚠️ Fixed ${fixedCount} issues. ${remainingCount} remain (content conflicts, missing files — manual fix needed).`,
                                8000
                            );
                        }
                        if (after.reportPath) {
                            new Notice(`Report: ${after.reportPath}`, 5000);
                        }
                    } catch (error) {
                        progressNotice.hide();
                        new Notice(`Fix Database error: ${error.message}`);
                    }
                })
            );

        new Setting(containerEl)
            .setName('Verify Database')
            .setDesc('Scan vault and Todoist, generate a full report showing task counts and all inconsistencies. No changes made.')
            .addButton(button => button
                .setButtonText('Verify')
                .onClick(async () => {
                    if (!this.plugin.settings.apiInitialized) {
                        new Notice('Please set the Todoist API first');
                        return;
                    }
                    if (!this.plugin.databaseChecker) {
                        new Notice('Database checker not initialized');
                        return;
                    }
                    const verifyNotice = new Notice('Verifying database...', 0);
                    try {
                        const result = await this.plugin.databaseChecker.checkDatabase((msg) => {
                            verifyNotice.setMessage(msg);
                        });
                        verifyNotice.hide();
                        const todoistCount = this.plugin.todoistSyncAPI?.getSyncData()?.items?.length ?? 0;
                        const vaultCount = Object.keys(this.plugin.settings.taskFileMapping).length;
                        const status = result.success ? '✅ Healthy' : `⚠️ ${result.totalIssues} issues`;
                        new Notice(
                            `Verify complete — ${status}\nTodoist: ${todoistCount} tasks | Vault: ${vaultCount} mapped tasks`,
                            8000
                        );
                        if (result.reportPath) {
                            new Notice(`Report: ${result.reportPath}`, 5000);
                        }
                    } catch (error) {
                        verifyNotice.hide();
                        new Notice(`Verify error: ${error.message}`);
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
                    .onChange(async (value) => {
                        await this.plugin.safeSettings?.update({ enableLog: value }, true)
                    })
            );

        new Setting(containerEl)
            .setName('Debug Mode')
            .setDesc('Output detailed logs to console for troubleshooting.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.debugMode)
                    .onChange(async (value) => {
                        await this.plugin.safeSettings?.update({ debugMode: value }, true)
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
                            await this.plugin.safeSettings?.update({ storageDirectory: newDir }, true);
                            new Notice('Storage directory changed. Please reload the plugin.');
                        } else {
                            new Notice('Migration failed. Check console for details.');
                        }
                    } else {
                        await this.plugin.safeSettings?.update({ storageDirectory: newDir }, true);
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
                    this.plugin.todoistToObsidian.backupTodoistAllResources()
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

                    await this.plugin.safeSettings?.reset();
                    new Notice('Settings reset. Please reload the plugin.');
                });
            });
    }
}
