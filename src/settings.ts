import { App, PluginSettingTab, Setting } from 'obsidian';
import VaultOutlinePlugin from './main';

export interface VaultOutlineSettings {
	maxDepth: number;
}

export const DEFAULT_SETTINGS: VaultOutlineSettings = {
	maxDepth: 5,
};

export class VaultOutlineSettingTab extends PluginSettingTab {
	plugin: VaultOutlinePlugin;

	constructor(app: App, plugin: VaultOutlinePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Vault outline settings' });

		new Setting(containerEl)
			.setName('Maximum depth')
			.setDesc('How many levels deep to follow links. Increase for larger graphs, or lower it to keep the outline compact.')
			.addText(text =>
				text
					.setPlaceholder('5')
					.setValue(String(this.plugin.settings.maxDepth))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed > 0) {
							this.plugin.settings.maxDepth = parsed;
							await this.plugin.saveSettings();
						}
					})
			);
	}
}
