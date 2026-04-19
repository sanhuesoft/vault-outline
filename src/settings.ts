import { App, PluginSettingTab, Setting } from 'obsidian';
import VaultOutlinePlugin from './main';

/**
 * An individual source from which bullet wikilinks are extracted.
 *
 * - `comment-block`  – wikilinks inside `%% … %%` comment blocks.
 * - `end-of-document` – wikilinks in the last trailing bullet-list block of the note.
 * - `under-heading`  – wikilinks below a heading whose text matches `linkSearchHeading`.
 *
 * Multiple sources can be enabled simultaneously; results are unioned and deduplicated.
 */
export type LinkSource = 'comment-block' | 'end-of-document' | 'under-heading';

/**
 * Runtime options passed into graph functions.
 * Built from `VaultOutlineSettings` before each tree traversal.
 */
export interface LinkSearchOptions {
	sources: LinkSource[];
	/** Only used when `sources` includes `'under-heading'`. */
	headingName: string;
}

export interface VaultOutlineSettings {
	maxDepth: number;
	wrapText: boolean;
	indexNoteName: string;
	linkSources: LinkSource[];
	linkSearchHeading: string;
}

export const DEFAULT_SETTINGS: VaultOutlineSettings = {
	maxDepth: 5,
	wrapText: false,
	indexNoteName: '§ Índice de mapas',
	linkSources: ['comment-block'],
	linkSearchHeading: 'Subnotas',
};

// ---------------------------------------------------------------------------
// Helper used in the settings tab
// ---------------------------------------------------------------------------

function setSource(sources: LinkSource[], source: LinkSource, enabled: boolean): LinkSource[] {
	const next = sources.filter(s => s !== source);
	if (enabled) next.push(source);
	return next;
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

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

		// --- Link sources ---------------------------------------------------

		containerEl.createEl('h3', { text: 'Link sources' });
		new Setting(containerEl)
			.setDesc('Choose which bullet wikilinks are followed when building the outline tree. Any combination can be enabled; results from all active sources are merged.');

		new Setting(containerEl)
			.setName('Comment blocks')
			.setDesc('Bullet wikilinks inside %% … %% comment blocks.')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.linkSources.includes('comment-block'))
					.onChange(async (value) => {
						this.plugin.settings.linkSources = setSource(this.plugin.settings.linkSources, 'comment-block', value);
						await this.plugin.saveSettings();
						this.plugin.refreshOutlineView();
					})
			);

		new Setting(containerEl)
			.setName('End of document')
			.setDesc('Bullet wikilinks in the last trailing list block of the note (after all body content).')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.linkSources.includes('end-of-document'))
					.onChange(async (value) => {
						this.plugin.settings.linkSources = setSource(this.plugin.settings.linkSources, 'end-of-document', value);
						await this.plugin.saveSettings();
						this.plugin.refreshOutlineView();
					})
			);

		new Setting(containerEl)
			.setName('Under heading')
			.setDesc('Bullet wikilinks found below a specific heading (see "Heading name" below).')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.linkSources.includes('under-heading'))
					.onChange(async (value) => {
						this.plugin.settings.linkSources = setSource(this.plugin.settings.linkSources, 'under-heading', value);
						await this.plugin.saveSettings();
						headingNameSetting.settingEl.style.display = value ? '' : 'none';
						this.plugin.refreshOutlineView();
					})
			);

		const headingNameSetting = new Setting(containerEl)
			.setName('Heading name')
			.setDesc('Bullet wikilinks below the first heading matching this text (case-insensitive) are followed. The section ends at the next heading of equal or higher level.')
			.addText(text =>
				text
					.setPlaceholder('Subnotas')
					.setValue(this.plugin.settings.linkSearchHeading)
					.onChange(async (value) => {
						this.plugin.settings.linkSearchHeading = value.trim();
						await this.plugin.saveSettings();
						if (this.plugin.settings.linkSources.includes('under-heading')) {
							this.plugin.refreshOutlineView();
						}
					})
			);
		// Show only when "under-heading" source is active.
		headingNameSetting.settingEl.style.display =
			this.plugin.settings.linkSources.includes('under-heading') ? '' : 'none';


	}
}
