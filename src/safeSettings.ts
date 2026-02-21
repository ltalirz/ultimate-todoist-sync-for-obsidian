import { DEFAULT_SETTINGS } from "./settings";
import UltimateTodoistSyncForObsidian from "../main";

export class SafeSettings {
    private plugin: UltimateTodoistSyncForObsidian;

    constructor(plugin: UltimateTodoistSyncForObsidian) {
        this.plugin = plugin;
    }

    async update(changes: Partial<typeof this.plugin.settings>, shouldSave = false): Promise<void> {
        // 防御性检查：确保 settingsBackup 存在
        if (!this.plugin.settingsBackup) {
            console.warn('[SafeSettings] settingsBackup not initialized, applying changes without backup');
        } else {
            await this.plugin.settingsBackup.backup();
        }

        try {
            Object.assign(this.plugin.settings, changes);

            if (shouldSave) {
                await this.plugin.saveSettings();
            }
        } catch (error) {
            console.error('[SafeSettings] Update failed:', error);
            // 尝试恢复（如果 settingsBackup 存在）
            if (this.plugin.settingsBackup) {
                await this.plugin.settingsBackup.restore();
            }
            throw error;
        }
    }

    async reset(): Promise<void> {
        if (!this.plugin.settingsBackup) {
            console.warn('[SafeSettings] settingsBackup not initialized, resetting without backup');
        } else {
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
