import { ItemView, Menu, Modal, TFile, WorkspaceLeaf } from 'obsidian';
import { buildOutlineTree, collectTreePaths, insertSubnote, ensureIndexedFrontmatter, reorderSubnotes } from './graph';
import { VaultOutlineSettings } from './settings';
import { OutlineNode } from './types';

export const VIEW_TYPE_VAULT_OUTLINE = 'vault-outline-view';

function getDroppedFileName(e: DragEvent): string | null {
    try {
        const dndData = e.dataTransfer?.getData('application/x-dnd');
        if (dndData) {
            const parsed = JSON.parse(dndData);
            if (parsed?.type === 'file' && parsed.files?.length > 0) {
                const path = parsed.files[0] as string;
                return path.split('/').pop()?.replace(/\.md$/, '') ?? null;
            }
        }
    } catch (err) {}

    const text = e.dataTransfer?.getData('text/plain');
    if (text) {
        const match = text.match(/\[\[([^\]]+)\]\]/);
        if (match) return match[1]?.split('|')[0] ?? null;
        // Strip vault-relative path prefix and .md extension
        const base = text.trim().split('/').pop() ?? text.trim();
        return base.replace(/\.md$/, '') || null;
    }
    return null;
}

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
        const linkSearchOptions = {
            sources: this.settings.linkSources,
            headingName: this.settings.linkSearchHeading,
        };

        buildOutlineTree(this.app, rootFile, this.settings.maxDepth, linkSearchOptions).then(async ({ tree, isMap }) => {
            if (this.currentFile?.path !== rootFile.path) return;

            this.treeFilePaths = collectTreePaths(tree);
            const container = this.containerEl.children[1] as HTMLElement;
            container.empty();

            const rootCls = 'vault-outline-root' + (this.settings.wrapText ? ' vault-outline-wrap' : '');
            const root = container.createDiv({ cls: rootCls });
            this.renderNode(root, tree, null, true);

            // Only mark notes as indexed when the tree is rooted at a real #mapa note
            if (isMap) {
                const anyModified = await ensureIndexedFrontmatter(this.app, Array.from(this.treeFilePaths));
                if (anyModified && this.currentFile?.path === rootFile.path) {
                    this.refresh();
                }
            }
        });
    }

    private renderNode(parent: HTMLElement, node: OutlineNode, parentNode: OutlineNode | null, isRoot: boolean): void {
        const hasChildren = node.children.length > 0;

        // Outer container
        const item = parent.createDiv({ cls: 'tree-item vault-outline-node' });
        if (isRoot) item.addClass('vault-outline-node-root');

        // Self row (the clickable / toggle row)
        const self = item.createDiv({ cls: 'tree-item-self' });
        self.setAttribute('tabindex', '0');

        // Drag & Drop event bindings
        self.setAttribute('draggable', 'true');

        this.registerDomEvent(self, 'dragover', (e: DragEvent) => {
            e.preventDefault();
            if (!e.dataTransfer) return;
            e.dataTransfer.dropEffect = 'copy';
            self.style.background = 'var(--background-modifier-hover)';
        });

        this.registerDomEvent(self, 'dragleave', (e: DragEvent) => {
            self.style.background = '';
        });

        this.registerDomEvent(self, 'drop', async (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            self.style.background = '';

            const dragManager = (this.app as any).dragManager;
            const draggable = dragManager?.draggable;

            let droppedBasename: string | null = null;
            if (draggable?.type === 'file' && draggable.file instanceof TFile) {
                droppedBasename = draggable.file.basename;
            } else if (draggable?.type === 'files' && Array.isArray(draggable.files)) {
                const first = draggable.files[0];
                if (first instanceof TFile) droppedBasename = first.basename;
            } else {
                droppedBasename = getDroppedFileName(e);
            }

            if (!droppedBasename) return;
            await insertSubnote(this.app, node, parentNode, droppedBasename, 'child');
        });

        let childrenContainer: HTMLElement | null = null;
        if (hasChildren) {
            const icon = self.createDiv({ cls: 'tree-item-icon collapse-icon' });
            icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8L12 17L21 8"/></svg>`;

            childrenContainer = item.createDiv({ cls: 'tree-item-children' });
            for (const child of node.children) {
                this.renderNode(childrenContainer, child, node, false);
            }

            this.registerDomEvent(icon, 'click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                item.classList.toggle('is-collapsed');
            });
        } else {
            self.createDiv({ cls: 'tree-item-icon' });
        }


        const isActive = node.file === this.activeFilePath;
        const text = self.createDiv({
            cls: 'tree-item-inner vault-outline-link' + (isRoot ? ' vault-outline-root-link' : '')
        });
        text.setText(node.name);
        text.setAttribute('aria-label', node.file);

        if (isActive) self.addClass('vault-outline-active');

        this.registerDomEvent(self, 'click', (e) => {
            if ((e.target as HTMLElement).closest('.tree-item-icon')) return;
            this.app.workspace.openLinkText(node.file, '', false);
        });

        this.registerDomEvent(self, 'contextmenu', (e: MouseEvent) => {
            e.preventDefault();
            const menu = new Menu();
            menu.addItem((item) => item
                .setTitle('Open in current tab')
                .setIcon('arrow-right')
                .onClick(() => this.app.workspace.openLinkText(node.file, '', false))
            );
            menu.addItem((item) => item
                .setTitle('Open in new tab')
                .setIcon('plus')
                .onClick(() => this.app.workspace.openLinkText(node.file, '', true))
            );
            if (hasChildren) {
                menu.addSeparator();
                menu.addItem((item) => item
                    .setTitle('Rearrange subnotes')
                    .setIcon('list-ordered')
                    .onClick(() => {
                        new RearrangeModal(this.app, node, async (newOrder) => {
                            await reorderSubnotes(this.app, node, newOrder);
                        }).open();
                    })
                );
            }
            menu.showAtMouseEvent(e);
        });

        this.registerDomEvent(self, 'keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.app.workspace.openLinkText(node.file, '', false);
            }
        });
    }
}

class RearrangeModal extends Modal {
    private node: OutlineNode;
    private items: string[];
    private onSave: (newOrder: string[]) => Promise<void>;

    constructor(app: import('obsidian').App, node: OutlineNode, onSave: (newOrder: string[]) => Promise<void>) {
        super(app);
        this.node = node;
        this.items = node.children.map(c => c.name);
        this.onSave = onSave;
    }

    onOpen() {
        this.render();
    }

    private render() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: `Rearrange subnotes of "${this.node.name}"` });

        const list = contentEl.createDiv({ cls: 'vault-outline-rearrange-list' });
        this.items.forEach((name, idx) => {
            const row = list.createDiv({ cls: 'vault-outline-rearrange-row' });
            row.createSpan({ text: name, cls: 'vault-outline-rearrange-name' });
            const btns = row.createDiv({ cls: 'vault-outline-rearrange-buttons' });

            if (idx > 0) {
                const up = btns.createEl('button', { text: '↑' });
                up.addEventListener('click', () => {
                    const prev = this.items[idx - 1];
                    const curr = this.items[idx];
                    if (prev !== undefined && curr !== undefined) {
                        this.items[idx - 1] = curr;
                        this.items[idx] = prev;
                        this.render();
                    }
                });
            }
            if (idx < this.items.length - 1) {
                const down = btns.createEl('button', { text: '↓' });
                down.addEventListener('click', () => {
                    const curr = this.items[idx];
                    const next = this.items[idx + 1];
                    if (curr !== undefined && next !== undefined) {
                        this.items[idx] = next;
                        this.items[idx + 1] = curr;
                        this.render();
                    }
                });
            }
        });

        const actions = contentEl.createDiv({ cls: 'vault-outline-rearrange-actions' });
        const saveBtn = actions.createEl('button', { text: 'Save order', cls: 'mod-cta' });
        saveBtn.addEventListener('click', async () => {
            await this.onSave([...this.items]);
            this.close();
        });
        actions.createEl('button', { text: 'Cancel' })
            .addEventListener('click', () => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}