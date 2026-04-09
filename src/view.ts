import { ItemView, Menu, TFile, WorkspaceLeaf } from 'obsidian';
import { buildOutlineTree, collectTreePaths } from './graph';
import { VaultOutlineSettings } from './settings';
import { OutlineNode } from './types';

export const VIEW_TYPE_VAULT_OUTLINE = 'vault-outline-view';

export class VaultOutlineView extends ItemView {
	private settings: VaultOutlineSettings;
	public currentFile: TFile | null = null;
	private treeFilePaths: Set<string> = new Set();
	private activeFilePath: string | null = null;

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
		this.activeFilePath = file?.path ?? null;
		this.refresh();
	}

	setActiveFile(path: string): void {
		this.activeFilePath = path;
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
			const rootCls = 'vault-outline-root' + (this.settings.wrapText ? ' vault-outline-wrap' : '');
			const root = container.createDiv({ cls: rootCls });
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
		self.setAttribute('tabindex', '0');

		let childrenContainer: HTMLElement | null = null;

		if (hasChildren) {
			// Collapse arrow — Obsidian styles this via .tree-item-icon
			const icon = self.createDiv({ cls: 'tree-item-icon collapse-icon' });
			icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8L12 17L21 8"/></svg>`;

			childrenContainer = item.createDiv({ cls: 'tree-item-children' });
			for (const child of node.children) {
				this.renderNode(childrenContainer, child, false);
			}

			this.registerDomEvent(icon, 'click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				item.classList.toggle('is-collapsed');
				childrenContainer!.style.display = item.classList.contains('is-collapsed') ? 'none' : '';
			});
		} else {
			// placeholder to align with icons
			self.createDiv({ cls: 'tree-item-icon' });
		}

		// The note name (not an anchor element so it doesn't get link styling)
		const isActive = node.file === this.activeFilePath;
		const text = self.createDiv({ cls: 'tree-item-inner vault-outline-link' + (isRoot ? ' vault-outline-root-link' : '') });
		text.setText(node.name);
		text.setAttribute('aria-label', node.file);
		if (isActive) self.addClass('vault-outline-active');

		// Clicking anywhere in the row (except the icon) opens the note in the current tab
		this.registerDomEvent(self, 'click', (e) => {
			if ((e.target as HTMLElement).closest('.tree-item-icon')) return;
			this.app.workspace.openLinkText(node.file, '', false);
		});

		// Right-click context menu
		this.registerDomEvent(self, 'contextmenu', (e: MouseEvent) => {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle('Open in current tab')
					.setIcon('arrow-right')
					.onClick(() => this.app.workspace.openLinkText(node.file, '', false))
			);
			menu.addItem((item) =>
				item
					.setTitle('Open in new tab')
					.setIcon('plus')
					.onClick(() => this.app.workspace.openLinkText(node.file, '', true))
			);
			menu.showAtMouseEvent(e);
		});

		// Keyboard activation (Enter / Space)
		this.registerDomEvent(self, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this.app.workspace.openLinkText(node.file, '', false);
			}
		});
	}
}
