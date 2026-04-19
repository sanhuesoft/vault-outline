import { App, PluginSettingTab, Setting } from 'obsidian';
import VaultOutlinePlugin from './main';

export interface VaultOutlineSettings {
	maxDepth: number;
	wrapText: boolean;
	indexNoteName: string;
}

export const DEFAULT_SETTINGS: VaultOutlineSettings = {
	maxDepth: 5,
	wrapText: false,
	indexNoteName: '§ Índice de mapas',
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

		new Setting(containerEl)
			.setName('Index note name')
			.setDesc('Name of the note to show when no note is open. This note is used as the general index.')
			.addText(text =>
				text
					.setPlaceholder('§ Índice de mapas')
					.setValue(this.plugin.settings.indexNoteName)
					.onChange(async (value) => {
						this.plugin.settings.indexNoteName = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Wrap note titles')
			.setDesc('When enabled, long note titles wrap to multiple lines. When disabled, titles stay on a single line.')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.wrapText)
					.onChange(async (value) => {
						this.plugin.settings.wrapText = value;
						await this.plugin.saveSettings();
						this.plugin.refreshOutlineView();
					})
			);
	}
}
