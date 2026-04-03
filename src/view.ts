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

		// Show a loading state while the async build runs
		const rootFile = this.currentFile;
		buildOutlineTree(this.app, rootFile, this.settings.maxDepth).then((tree) => {
			// Abort if the file changed while we were building
			if (this.currentFile?.path !== rootFile.path) return;

			this.treeFilePaths = collectTreePaths(tree);

			const container = this.containerEl.children[1] as HTMLElement;
			container.empty();
			const ul = container.createEl('ul', { cls: 'vault-outline-list' });
			this.renderNode(ul, tree, true);
		});
	}

	private renderNode(parent: HTMLElement, node: OutlineNode, isRoot: boolean): void {
		const li = parent.createEl('li', { cls: 'vault-outline-item' });

		const link = li.createEl('a', {
			cls: isRoot ? 'vault-outline-link vault-outline-root-link' : 'vault-outline-link',
		});
		link.setText(node.name);
		link.setAttribute('aria-label', node.file);

		this.registerDomEvent(link, 'click', () => {
			this.app.workspace.openLinkText(node.file, '', true);
		});

		if (node.children.length > 0) {
			const ul = li.createEl('ul', { cls: 'vault-outline-list' });
			for (const child of node.children) {
				this.renderNode(ul, child, false);
			}
		}
	}
}

