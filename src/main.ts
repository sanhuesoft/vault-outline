import { MarkdownView, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, VaultOutlineSettings, VaultOutlineSettingTab } from './settings';
import { VaultOutlineView, VIEW_TYPE_VAULT_OUTLINE } from './view';

export default class VaultOutlinePlugin extends Plugin {
	settings: VaultOutlineSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_VAULT_OUTLINE,
			(leaf) => new VaultOutlineView(leaf, this.settings)
		);

		this.addRibbonIcon('list-tree', 'Vault outline', () => {
			this.activateView();
		});

		this.addCommand({
			id: 'open-vault-outline',
			name: 'Open vault outline',
			callback: () => this.activateView(),
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
				if (view && view.currentFile?.path === file.path) {
					view.refresh();
				}
			})
		);

		this.app.workspace.onLayoutReady(() => {
			this.activateView();
		});
	}

	async onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_VAULT_OUTLINE);
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
			workspace.revealLeaf(leaf);
		}

		this.updateView();
	}

	private updateView() {
		const view = this.getOutlineView();
		if (!view) return;

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView?.file) return;

		// If the newly active note is already part of the current tree,
		// keep the existing outline intact (stable root) but update the highlight.
		if (view.isInCurrentTree(activeView.file)) {
			view.setActiveFile(activeView.file.path);
			return;
		}

		view.setFile(activeView.file);
	}

	refreshOutlineView(): void {
		this.getOutlineView()?.refresh();
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
