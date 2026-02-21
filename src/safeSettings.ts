import UltimateTodoistSyncForObsidian from "../main";

export class SafeSettings {
    private plugin: UltimateTodoistSyncForObsidian;

    constructor(plugin: UltimateTodoistSyncForObsidian) {
        this.plugin = plugin;
    }

    async update(changes: Partial<typeof this.plugin.settings>, shouldSave = false): Promise<void> {
        await this.plugin.settingsBackup?.backup();

        try {
            Object.assign(this.plugin.settings, changes);

            if (shouldSave) {
                await this.plugin.saveSettings();
            }

            console.log('[SafeSettings] Update completed successfully');
        } catch (error) {
            console.error('[SafeSettings] Update failed, restoring from backup...', error);
            await this.plugin.settingsBackup?.restore();
            throw error;
        }
    }
}
