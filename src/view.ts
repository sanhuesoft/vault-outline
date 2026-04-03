import { ItemView, TFile, WorkspaceLeaf } from 'obsidian';
import { buildOutlineTree, collectTreePaths } from './graph';
import { VaultOutlineSettings } from './settings';
import { OutlineNode } from './types';

export const VIEW_TYPE_VAULT_OUTLINE = 'vault-outline-view';

export class VaultOutlineView extends ItemView {
	private settings: VaultOutlineSettings;
	public currentFile: TFile | null = null;
	private treeFilePaths: Set<string> = new Set();

	constructor(leaf: WorkspaceLeaf, settings: VaultOutlineSettings) {
		super(leaf);
		this.settings = settings;
	}

	getViewType(): string {
		return VIEW_TYPE_VAULT_OUTLINE;
	}

	getDisplayText(): string {
		return 'Vault outline';
	}

	getIcon(): string {
		return 'list-tree';
	}

	async onOpen(): Promise<void> {
		this.refresh();
	}

	async onClose(): Promise<void> {
		// Nothing to clean up
	}

	/** Returns true if the given file is part of the currently displayed tree. */
	isInCurrentTree(file: TFile): boolean {
		return this.treeFilePaths.has(file.path);
	}

	setFile(file: TFile | null): void {
		this.currentFile = file;
		this.refresh();
	}

	refresh(): void {
		const content = this.containerEl.children[1] as HTMLElement;
		content.empty();

		if (!this.currentFile) {
			this.treeFilePaths = new Set();
			content.createEl('p', {
				text: 'Open a note to see its outline.',
				cls: 'vault-outline-empty',
			});
			return;
		}

		const rootFile = this.currentFile;
		buildOutlineTree(this.app, rootFile, this.settings.maxDepth).then((tree) => {
			if (this.currentFile?.path !== rootFile.path) return;

			this.treeFilePaths = collectTreePaths(tree);

			const container = this.containerEl.children[1] as HTMLElement;
			container.empty();
			const root = container.createDiv({ cls: 'vault-outline-root' });
			this.renderNode(root, tree, true);
		});
	}

	private renderNode(parent: HTMLElement, node: OutlineNode, isRoot: boolean): void {
		const hasChildren = node.children.length > 0;

		// Outer container — mirrors how Obsidian's own tree works
		const item = parent.createDiv({ cls: 'tree-item vault-outline-node' });
		if (isRoot) item.addClass('vault-outline-node-root');

		// Self row (the clickable / toggle row)
		const self = item.createDiv({ cls: 'tree-item-self' });

		if (hasChildren) {
			// Collapse arrow — Obsidian styles this via .tree-item-icon
			const icon = self.createDiv({ cls: 'tree-item-icon collapse-icon' });
			// Use the same svg chevron Obsidian uses in its own panels
			icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
				fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
				class="svg-icon right-triangle"><path d="M3 8L12 17L21 8"/></svg>`;

			const children = item.createDiv({ cls: 'tree-item-children' });
			for (const child of node.children) {
				this.renderNode(children, child, false);
			}

			this.registerDomEvent(self, 'click', (e) => {
				// Only toggle when clicking the icon (not the link text)
				if ((e.target as HTMLElement).closest('.vault-outline-link')) return;
				item.classList.toggle('is-collapsed');
				children.style.display = item.classList.contains('is-collapsed') ? 'none' : '';
			});
		}

		// The note name link
		const link = self.createEl('a', {
			cls: 'tree-item-inner vault-outline-link' + (isRoot ? ' vault-outline-root-link' : ''),
		});
		link.setText(node.name);
		link.setAttribute('aria-label', node.file);

		this.registerDomEvent(link, 'click', () => {
			this.app.workspace.openLinkText(node.file, '', true);
		});
	}
}


