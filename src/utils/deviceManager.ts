import { App } from 'obsidian';
import UltimateTodoistSyncForObsidian from '../../main';

export class DeviceManager {
    private app: App;
    private plugin: UltimateTodoistSyncForObsidian;
    private deviceId = '';

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    private getPluginPath(): string {
        return this.plugin.manifest.dir || `${this.app.vault.configDir}/plugins/ultimate-todoist-sync`;
    }

    private getDeviceIdPath(): string {
        return `${this.getPluginPath()}/device-id`;
    }

    private getDeviceName(): string {
        try {
            const os = require('os');
            return os.hostname() || 'unknown';
        } catch {
            return 'unknown';
        }
    }

    private generateRandomString(length: number): string {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    async getDeviceId(): Promise<string> {
        if (this.deviceId) {
            return this.deviceId;
        }

        const deviceIdPath = this.getDeviceIdPath();

        try {
            const adapter = this.app.vault.adapter;
            
            if (await adapter.exists(deviceIdPath)) {
                const content = await adapter.read(deviceIdPath);
                this.deviceId = content.trim();
                return this.deviceId;
            }

            const deviceName = this.getDeviceName();
            const randomStr = this.generateRandomString(16);
            this.deviceId = `obsidian_${deviceName}_${randomStr}`;

            await adapter.write(deviceIdPath, this.deviceId);

            this.plugin.debugLog(`[DeviceManager] Created new device ID: ${this.deviceId}`);
            return this.deviceId;

        } catch (error) {
            console.error('[DeviceManager] Error getting/creating device ID:', error);
            const fallbackId = `obsidian_unknown_${this.generateRandomString(16)}`;
            console.warn(`[DeviceManager] Using fallback device ID: ${fallbackId}`);
            return fallbackId;
        }
    }

    async getClientHeader(): Promise<string> {
        return await this.getDeviceId();
    }

    async getDeviceIdInfo(): Promise<{ deviceId: string; path: string }> {
        const deviceId = await this.getDeviceId();
        const path = this.getDeviceIdPath();
        return { deviceId, path };
    }
}
