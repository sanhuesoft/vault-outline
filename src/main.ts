import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, VaultOutlineSettings, VaultOutlineSettingTab } from './settings';
import { VaultOutlineView, VIEW_TYPE_VAULT_OUTLINE, RearrangeModal } from './view';
import { hasMapTag, reorderSubnotes } from './graph';

export default class VaultOutlinePlugin extends Plugin {
	settings: VaultOutlineSettings;
	private activatingView = false;

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
			id: 'wikilink-lowercase-alias',
			name: 'Transform into lowercased aliased wikilink',
			editorCallback: (editor) => {
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);
				// Find all wikilinks on the line and pick the one under the cursor
				const wikilinkRe = /\[\[([^\]|]+?)(?:\|[^\]]*?)?\]\]/g;
				let match: RegExpExecArray | null;
				while ((match = wikilinkRe.exec(line)) !== null) {
					const start = match.index;
					const end = match.index + match[0].length;
					if (cursor.ch >= start && cursor.ch <= end) {
						const target = match[1] ?? match[0];
						const aliased = `[[${target}|${target.toLowerCase()}]]`;
						editor.replaceRange(
							aliased,
							{ line: cursor.line, ch: start },
							{ line: cursor.line, ch: end }
						);
						return;
					}
				}
				new Notice('No wikilink found under cursor.');
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
			})
		);

		this.app.workspace.onLayoutReady(() => {
			void this.activateView();
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
		// Guard against concurrent calls racing past the leaves.length check.
		if (this.activatingView) return;
		this.activatingView = true;
		try {
			const { workspace } = this.app;

			// Enforce a single instance: detach any extras before proceeding.
			const leaves = workspace.getLeavesOfType(VIEW_TYPE_VAULT_OUTLINE);
			for (let i = 1; i < leaves.length; i++) {
				leaves[i]?.detach();
			}

			let leaf: WorkspaceLeaf | null = leaves[0] ?? null;
			if (!leaf) {
				leaf = workspace.getRightLeaf(false);
				await leaf?.setViewState({ type: VIEW_TYPE_VAULT_OUTLINE, active: true });
			}

			if (leaf) {
				await workspace.revealLeaf(leaf);
			}

			this.updateView();
		} finally {
			this.activatingView = false;
		}
	}

	private updateView() {
		const view = this.getOutlineView();
		if (!view) return;

		// Pinned: don't react to navigation at all.
		if (view.isPinned()) return;

		// Master map mode: only update the active-note highlight, never re-root.
		if (view.getViewMode() === 'global') {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView?.file && view.isInCurrentTree(activeView.file)) {
				view.setActiveFile(activeView.file.path);
			}
			return;
		}

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
		// don't change anything — unless the view has never been initialized.
		const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
		if (markdownLeaves.length > 0) {
			if (!view.currentFile) {
				// Seed from the first available markdown leaf so the panel
				// isn't left blank when the user opens the plugin for the first time.
				const firstFile = (markdownLeaves[0]?.view as MarkdownView | undefined)?.file ?? null;
				if (firstFile) view.setFile(firstFile);
			}
			return;
		}

		// No open notes at all → fall back to the general index.
		const indexFile = this.app.vault.getMarkdownFiles().find(
			f => f.basename === this.settings.indexNoteName
		) ?? null;
		view.setFile(indexFile);
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
