import UltimateTodoistSyncForObsidian from "../main";

export class SafeSettings {
    private plugin: UltimateTodoistSyncForObsidian;

    constructor(plugin: UltimateTodoistSyncForObsidian) {
        this.plugin = plugin;
    }

    async update(changes: Partial<typeof this.plugin.settings>, shouldSave = false): Promise<void> {
        await this.plugin.settingsBackup?.backup();
        const backup = JSON.parse(JSON.stringify(this.plugin.settings));

        try {
            Object.assign(this.plugin.settings, changes);

            if (shouldSave) {
                await this.plugin.saveSettings();
            }

            console.log('[SafeSettings] Update completed successfully');
        } catch (error) {
            console.error('[SafeSettings] Update failed, rolling back...', error);
            this.plugin.settings = backup;
            await this.plugin.settingsBackup?.restore();
            throw error;
        }
    }

    updateSync(changes: Partial<typeof this.plugin.settings>, shouldSave = false): void {
        this.plugin.settingsBackup?.backup();
        const backup = JSON.parse(JSON.stringify(this.plugin.settings));

        try {
            Object.assign(this.plugin.settings, changes);

            if (shouldSave) {
                this.plugin.saveSettings();
            }

            console.log('[SafeSettings] UpdateSync completed successfully');
        } catch (error) {
            console.error('[SafeSettings] UpdateSync failed, rolling back...', error);
            this.plugin.settings = backup;
            this.plugin.settingsBackup?.restore();
            throw error;
        }
    }
}
