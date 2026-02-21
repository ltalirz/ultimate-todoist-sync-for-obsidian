import { DEFAULT_SETTINGS } from "./settings";
import UltimateTodoistSyncForObsidian from "../main";

export class SafeSettings {
    private plugin: UltimateTodoistSyncForObsidian;
    private lastBackupTime = 0;
    private static readonly BACKUP_THROTTLE_MS = 5 * 60 * 1000;

    constructor(plugin: UltimateTodoistSyncForObsidian) {
        this.plugin = plugin;
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
                await this.plugin.saveSettings();
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
            await this.plugin.saveSettings();
        } catch (error) {
            console.error('[SafeSettings] Reset failed:', error);
            if (this.plugin.settingsBackup) {
                await this.plugin.settingsBackup.restore();
            }
            throw error;
        }
    }
}
