import { ItemView, MarkdownView, Menu, Modal, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { buildOutlineTree, collectTreePaths, findRootMaps, insertSubnote, reorderSubnotes, removeSubnote } from './graph';
import { VaultOutlineSettings } from './settings';
import { OutlineNode } from './types';

export const VIEW_TYPE_VAULT_OUTLINE = 'vault-outline-view';

function getDroppedFileName(e: DragEvent): string | null {
    try {
        const dndData = e.dataTransfer?.getData('application/x-dnd');
        if (dndData) {
            const parsed = JSON.parse(dndData) as { type?: string; files?: string[] };
            if (parsed.type === 'file' && parsed.files && parsed.files.length > 0) {
                const path = parsed.files[0] as string;
                return path.split('/').pop()?.replace(/\.md$/, '') ?? null;
            }
        }
    } catch {
        // ignore parse errors
    }

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

interface AppDragManager {
    draggable?: { type?: string; file?: TFile; files?: TFile[] };
}

export class VaultOutlineView extends ItemView {
    private settings: VaultOutlineSettings;
    public currentFile: TFile | null = null;
    private treeFilePaths: Set<string> = new Set();
    public nodeMap: Map<string, OutlineNode> = new Map();
    private activeFilePath: string | null = null;
    private draggedNode: OutlineNode | null = null;
    private draggedParent: OutlineNode | null = null;
    private pinned = false;
    private viewMode: 'local' | 'global' = 'local';
    private pinBtn: HTMLElement | null = null;

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
        this.pinBtn = this.addAction('pin', 'Fijar esquema', () => {
            this.pinned = !this.pinned;
            this.pinBtn?.classList.toggle('is-active', this.pinned);
        });
        this.refresh();
    }

    async onClose(): Promise<void> {
        // Nothing to clean up
    }

    /** Returns true if the given file is part of the currently displayed tree. */
    isInCurrentTree(file: TFile): boolean {
        return this.treeFilePaths.has(file.path);
    }

    isPinned(): boolean { return this.pinned; }
    getViewMode(): 'local' | 'global' { return this.viewMode; }

    setFile(file: TFile | null): void {
        if (!file) {
            this.currentFile = null;
            this.activeFilePath = null;
            this.refresh();
            return;
        }

        // If there is no current outline yet, always show whatever file is opened.
        if (!this.currentFile) {
            this.currentFile = file;
            this.activeFilePath = file.path;
            this.refresh();
            return;
        }

        // Pre-check: build the tree to decide if it has meaningful content.
        // A lone note with no children and no map context should not replace
        // the current outline — the user likely clicked a tangential file.
        const linkSearchOptions = {
            sources: this.settings.linkSources,
            headingName: this.settings.linkSearchHeading,
        };
        void buildOutlineTree(this.app, file, this.settings.maxDepth, linkSearchOptions).then(({ tree, isMap }) => {
            if (!isMap && tree.children.length === 0) return;
            this.currentFile = file;
            this.activeFilePath = file.path;
            this.refresh();
        });
    }

    setActiveFile(path: string): void {
        this.activeFilePath = path;
        this.refresh();
    }

    refresh(): void {
        const content = this.containerEl.children[1] as HTMLElement;
        content.empty();
        this.renderToolbar(content);

        if (this.viewMode === 'global') {
            void this.renderGlobalView(content);
            return;
        }

        if (!this.currentFile) {
            this.treeFilePaths = new Set();
            const emptyEl = content.createDiv({ cls: 'vault-outline-empty' });
            emptyEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="32" height="32"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
            emptyEl.createEl('p', { text: 'First, open a note.' });
            return;
        }

        const rootFile = this.currentFile;
        const linkSearchOptions = {
            sources: this.settings.linkSources,
            headingName: this.settings.linkSearchHeading,
        };

        void buildOutlineTree(this.app, rootFile, this.settings.maxDepth, linkSearchOptions).then(async ({ tree, isMap }) => {
            if (this.currentFile?.path !== rootFile.path) return;

            this.treeFilePaths = collectTreePaths(tree);
            this.nodeMap.clear();
            const container = this.containerEl.children[1] as HTMLElement;
            container.empty();
            this.renderToolbar(container);

            const rootCls = 'vault-outline-root' + (this.settings.wrapText ? ` vault-outline-wrap vault-outline-wrap-lines-${this.settings.wrapLines}` : '');
            const root = container.createDiv({ cls: rootCls });
            this.renderNode(root, tree, null, true);
        });
    }

    private renderToolbar(container: HTMLElement): void {
        const toolbar = container.createDiv({ cls: 'vault-outline-toolbar' });

        // Pin button — only meaningful in local mode
        if (this.viewMode === 'local') {
            const pinBtn = toolbar.createEl('button', {
                cls: 'vault-outline-pin-btn' + (this.pinned ? ' is-active' : ''),
                attr: { 'aria-label': this.pinned ? 'Desfijar esquema' : 'Fijar esquema' },
            });
            pinBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`;
            pinBtn.addEventListener('click', () => {
                this.pinned = !this.pinned;
                this.pinBtn?.classList.toggle('is-active', this.pinned);
                this.refresh();
            });
        }

        const modeGroup = toolbar.createDiv({ cls: 'vault-outline-mode-group' });

        const localBtn = modeGroup.createEl('button', { cls: 'vault-outline-mode-btn' });
        localBtn.setText('Esquema local');
        if (this.viewMode === 'local') localBtn.addClass('is-active');

        const globalBtn = modeGroup.createEl('button', { cls: 'vault-outline-mode-btn' });
        globalBtn.setText('Esquema global');
        if (this.viewMode === 'global') globalBtn.addClass('is-active');

        localBtn.addEventListener('click', () => this.switchToLocal());
        globalBtn.addEventListener('click', () => this.switchToGlobal());
    }

    private switchToLocal(): void {
        if (this.viewMode === 'local') return;
        this.viewMode = 'local';
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView?.file) {
            this.currentFile = activeView.file;
            this.activeFilePath = activeView.file.path;
        } else {
            this.currentFile = null;
            this.activeFilePath = null;
        }
        this.refresh();
    }

    private switchToGlobal(): void {
        if (this.viewMode === 'global') return;
        this.viewMode = 'global';
        // Global mode doesn't pin and doesn't need a currentFile root
        this.pinned = false;
        this.pinBtn?.classList.remove('is-active');
        this.currentFile = null;
        this.activeFilePath = null;
        this.refresh();
    }

    private async renderGlobalView(container: HTMLElement): Promise<void> {
        const linkSearchOptions = {
            sources: this.settings.linkSources,
            headingName: this.settings.linkSearchHeading,
        };
        const roots = await findRootMaps(this.app, linkSearchOptions);
        if (this.viewMode !== 'global') return; // mode changed while loading

        if (roots.length === 0) {
            const emptyEl = container.createDiv({ cls: 'vault-outline-empty' });
            emptyEl.createEl('p', { text: 'No se encontraron mapas raíz.' });
            return;
        }

        roots.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { sensitivity: 'base' }));
        const list = container.createDiv({ cls: 'vault-outline-root' });
        for (const mapFile of roots) {
            const item = list.createDiv({ cls: 'tree-item vault-outline-node vault-outline-node-root' });
            const self = item.createDiv({ cls: 'tree-item-self' });
            self.setAttribute('tabindex', '0');
            self.createDiv({ cls: 'tree-item-icon' });
            const text = self.createDiv({ cls: 'tree-item-inner vault-outline-link vault-outline-root-link' });
            text.setText(mapFile.basename);
            this.registerDomEvent(self, 'click', () => {
                void this.app.workspace.openLinkText(mapFile.path, '', false);
            });
            this.registerDomEvent(self, 'keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void this.app.workspace.openLinkText(mapFile.path, '', false);
                }
            });
        }
    }

    private renderNode(parent: HTMLElement, node: OutlineNode, parentNode: OutlineNode | null, isRoot: boolean): void {
        const hasChildren = node.children.length > 0;

        // ── Virtual grouping node ──────────────────────────────────────────────
        if (node.virtual) {
            const item = parent.createDiv({ cls: 'tree-item vault-outline-node vault-outline-virtual' });
            const self = item.createDiv({ cls: 'tree-item-self' });

            if (hasChildren) {
                const icon = self.createDiv({ cls: 'tree-item-icon collapse-icon' });
                icon.createSvg('svg', { attr: { xmlns: 'http://www.w3.org/2000/svg', width: '12', height: '12', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } }).createSvg('path', { attr: { d: 'M3 8L12 17L21 8' } });
                const childrenContainer = item.createDiv({ cls: 'tree-item-children' });
                // Pass parentNode (the real file ancestor) so children's context menu works correctly
                for (const child of node.children) {
                    this.renderNode(childrenContainer, child, parentNode, false);
                }
                this.registerDomEvent(icon, 'click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    item.classList.toggle('is-collapsed');
                });
            } else {
                self.createDiv({ cls: 'tree-item-icon' });
            }

            self.createDiv({ cls: 'tree-item-inner vault-outline-virtual-label' }).setText(node.name);
            return;
        }

        // ── Real file node ─────────────────────────────────────────────────────

        // Register this node so command palette commands can look it up
        this.nodeMap.set(node.file, node);

        // Outer container
        const item = parent.createDiv({ cls: 'tree-item vault-outline-node' });
        if (isRoot) item.addClass('vault-outline-node-root');

        // Self row (the clickable / toggle row)
        const self = item.createDiv({ cls: 'tree-item-self' });
        self.setAttribute('tabindex', '0');

        // Drag & Drop event bindings
        self.setAttribute('draggable', 'true');

        this.registerDomEvent(self, 'dragstart', (e: DragEvent) => {
            if (isRoot || !parentNode) {
                e.preventDefault();
                return;
            }
            this.draggedNode = node;
            this.draggedParent = parentNode;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', node.name);
            }
            self.addClass('vault-outline-dragging');
        });

        this.registerDomEvent(self, 'dragend', () => {
            self.removeClass('vault-outline-dragging');
            this.draggedNode = null;
            this.draggedParent = null;
        });

        this.registerDomEvent(self, 'dragover', (e: DragEvent) => {
            e.preventDefault();
            if (!e.dataTransfer) return;
            e.dataTransfer.dropEffect = this.draggedNode ? 'move' : 'copy';
            self.addClass('vault-outline-drag-over');
        });

        this.registerDomEvent(self, 'dragleave', (e: DragEvent) => {
            self.removeClass('vault-outline-drag-over');
        });

        this.registerDomEvent(self, 'drop', async (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            self.removeClass('vault-outline-drag-over');

            // Internal tree drag: move a node to a new parent
            if (this.draggedNode) {
                const dragged = this.draggedNode;
                const draggedParent = this.draggedParent;
                this.draggedNode = null;
                this.draggedParent = null;

                if (!draggedParent) return;
                if (dragged.file === node.file) return;
                if (this.isDescendantOf(node, dragged)) return;
                if (draggedParent.file === node.file) return;

                await removeSubnote(this.app, draggedParent, dragged.name);
                await insertSubnote(this.app, node, parentNode, dragged.name, 'child');
                this.refresh();
                return;
            }

            // External file drop
            const dragManager = (this.app as unknown as { dragManager?: AppDragManager }).dragManager;
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
            icon.createSvg('svg', { attr: { xmlns: 'http://www.w3.org/2000/svg', width: '12', height: '12', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } }).createSvg('path', { attr: { d: 'M3 8L12 17L21 8' } });

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
        text.setText(node.alias ?? node.name);
        text.setAttribute('aria-label', node.file);

        if (isActive) self.addClass('vault-outline-active');

        this.registerDomEvent(self, 'click', (e) => {
            if ((e.target as HTMLElement).closest('.tree-item-icon')) return;
            void this.app.workspace.openLinkText(node.file, '', false);
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
                menu.addItem((menuItem) => menuItem
                    .setTitle('Collapse')
                    .setIcon('chevron-up')
                    .onClick(() => item.classList.add('is-collapsed'))
                );
                menu.addItem((menuItem) => menuItem
                    .setTitle('Expand')
                    .setIcon('chevron-down')
                    .onClick(() => item.classList.remove('is-collapsed'))
                );
                menu.addSeparator();
                menu.addItem((menuItem) => menuItem
                    .setTitle('Rearrange subnotes')
                    .setIcon('list-ordered')
                    .onClick(() => {
                        new RearrangeModal(this.app, node, async (newOrder) => {
                            await reorderSubnotes(this.app, node, newOrder);
                        }).open();
                    })
                );
            }

            menu.addSeparator();

            // Remove note: only available when the node has a parent
            if (parentNode) {
                menu.addItem((item) => item
                    .setTitle('Remove note')
                    .setIcon('trash')
                    .onClick(async () => {
                        await removeSubnote(this.app, parentNode, node.name, node.file);
                        this.refresh();
                    })
                );
            }

            const nodeFile = this.app.vault.getAbstractFileByPath(node.file);
            if (nodeFile instanceof TFile) {
                const cache = this.app.metadataCache.getFileCache(nodeFile);

                const tags: string[] = (cache?.frontmatter?.['tags'] as string[] | undefined) ?? [];
                const hasDefinicion = tags.some((t: string) =>
                    t.toLowerCase() === 'definición' || t.toLowerCase() === 'definicion'
                );
                if (!hasDefinicion) {
                    menu.addItem((item) => item
                        .setTitle('Add tag: definición')
                        .setIcon('tag')
                        .onClick(async () => {
                            await this.app.fileManager.processFrontMatter(nodeFile, (fm) => {
                                const fmRecord = fm as Record<string, unknown>;
                                const existing: string[] = (fmRecord['tags'] as string[] | undefined) ?? [];
                                if (!existing.some((t: string) =>
                                    t.toLowerCase() === 'definición' || t.toLowerCase() === 'definicion'
                                )) {
                                    fmRecord['tags'] = [...existing, 'Definición'];
                                }
                            });
                        })
                    );
                }
            }

            menu.showAtMouseEvent(e);
        });

        this.registerDomEvent(self, 'keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void this.app.workspace.openLinkText(node.file, '', false);
            }
        });
    }

    private isDescendantOf(potentialDescendant: OutlineNode, ancestor: OutlineNode): boolean {
        for (const child of ancestor.children) {
            if (child.file === potentialDescendant.file) return true;
            if (this.isDescendantOf(potentialDescendant, child)) return true;
        }
        return false;
    }
}

export class RearrangeModal extends Modal {
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
        saveBtn.addEventListener('click', () => {
            void this.onSave([...this.items]).then(() => { this.close(); });
        });
        actions.createEl('button', { text: 'Cancel' })
            .addEventListener('click', () => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}