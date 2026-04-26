import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { DEFAULT_SETTINGS, VaultOutlineSettings, VaultOutlineSettingTab } from './settings';
import { VaultOutlineView, VIEW_TYPE_VAULT_OUTLINE, RearrangeModal } from './view';
import { hasMapTag, reorderSubnotes } from './graph';

export default class VaultOutlinePlugin extends Plugin {
	settings: VaultOutlineSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_VAULT_OUTLINE,
			(leaf) => new VaultOutlineView(leaf, this.settings)
		);

		this.addRibbonIcon('list-tree', 'Vault outline', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open',
			name: 'Open',
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: 'add-indexed-flag',
			name: 'Add indexed flag to active note',
			callback: async () => {
				const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
				if (!file) {
					new Notice('No active note.');
					return;
				}
				const cache = this.app.metadataCache.getFileCache(file);
				if (cache?.frontmatter?.['indexed'] === true) {
					new Notice(`"${file.basename}" already has the indexed flag.`);
					return;
				}
				await this.app.fileManager.processFrontMatter(file, (fm) => { (fm as Record<string, unknown>)['indexed'] = true; });
			},
		});

		this.addCommand({
			id: 'add-definicion-tag',
			name: 'Add tag: definición to active note',
			callback: async () => {
				const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
				if (!file) {
					new Notice('No active note.');
					return;
				}
				const cache = this.app.metadataCache.getFileCache(file);
				const tags: string[] = (cache?.frontmatter?.['tags'] as string[] | undefined) ?? [];
				const already = tags.some((t: string) =>
					t.toLowerCase() === 'definición' || t.toLowerCase() === 'definicion'
				);
				if (already) {
					new Notice(`"${file.basename}" already has the Definición tag.`);
					return;
				}
				await this.app.fileManager.processFrontMatter(file, (fm) => {
					const fmRecord = fm as Record<string, unknown>;
					const existing: string[] = (fmRecord['tags'] as string[] | undefined) ?? [];
					fmRecord['tags'] = [...existing, 'Definición'];
				});
			},
		});

		this.addCommand({
			id: 'rearrange-subnotes',
			name: 'Rearrange subnotes of active note',
			callback: () => {
				const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
				if (!file) {
					new Notice('No active note.');
					return;
				}
				const view = this.getOutlineView();
				const node = view?.nodeMap.get(file.path);
				if (!node || node.children.length === 0) {
					new Notice(`"${file.basename}" has no subnotes to rearrange.`);
					return;
				}
				// Open the rearrange modal
				new RearrangeModal(this.app, node, async (newOrder: string[]) => {
					await reorderSubnotes(this.app, node, newOrder);
				}).open();
			},
		});

		this.addSettingTab(new VaultOutlineSettingTab(this.app, this));

		// Refresh when the active note changes
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.updateView();
			})
		);

		// Refresh when the current note's links change
		this.registerEvent(
			this.app.metadataCache.on('changed', (file: TFile) => {
				const view = this.getOutlineView();
				if (view && view.isInCurrentTree(file)) {
					view.refresh();
				}
				this.decorateFileExplorer();
			})
		);

		this.app.workspace.onLayoutReady(() => {
			void this.activateView();
			this.decorateFileExplorer();
		});
	}

	onunload() {
		// Do not detach leaves on unload — preserves user-defined panel position.
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<VaultOutlineSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_VAULT_OUTLINE);

		if (leaves.length > 0) {
			leaf = leaves[0] ?? null;
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_VAULT_OUTLINE, active: true });
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
		}

		this.updateView();
	}

	private updateView() {
		const view = this.getOutlineView();
		if (!view) return;

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.file) {
			// If the active note is itself a map, always re-root the outline at it.
			// Otherwise, if it is already part of the current tree, just update the highlight.
			if (!hasMapTag(this.app, activeView.file) && view.isInCurrentTree(activeView.file)) {
				view.setActiveFile(activeView.file.path);
				return;
			}
			view.setFile(activeView.file);
			return;
		}

		// No markdown view is currently focused.
		// If markdown notes are still open (user clicked on a panel like the outline),
		// don't change anything.
		const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
		if (markdownLeaves.length > 0) return;

		// No open notes at all → fall back to the general index.
		const indexFile = this.app.vault.getMarkdownFiles().find(
			f => f.basename === this.settings.indexNoteName
		) ?? null;
		view.setFile(indexFile);
	}

	refreshOutlineView(): void {
		this.getOutlineView()?.refresh();
	}

	private decorateFileExplorer(): void {
		const explorerLeaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
		if (!explorerLeaf) return;
		const explorerEl = explorerLeaf.view.containerEl;

		// Remove all existing decorations to avoid duplicates
		explorerEl.querySelectorAll('.vault-outline-indexed-icon').forEach(el => el.remove());

		// Re-add decorations for every indexed file
		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter?.['indexed'] !== true) continue;

			// Find the native file title element via the stable data-path attribute
			const titleEl = explorerEl.querySelector(
				`.nav-file-title[data-path="${file.path.replace(/"/g, '\\"')}"]`
			);
			if (!titleEl) continue;

			const iconEl = document.createElement('span');
			iconEl.addClass('vault-outline-indexed-icon');
			setIcon(iconEl, 'check');
			titleEl.appendChild(iconEl);
		}
	}

	private getOutlineView(): VaultOutlineView | null {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_VAULT_OUTLINE);
		const first = leaves[0];
		if (first && first.view instanceof VaultOutlineView) {
			return first.view;
		}
		return null;
	}
}
