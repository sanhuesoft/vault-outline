import { App, TFile, getAllTags } from 'obsidian';
import { LinkSearchOptions } from './settings';
import { OutlineNode } from './types';

const BULLET_WIKILINK = /^\s*-\s*\[\[([^\]]+)\]\]/;
const COMMENT_BLOCK_DELIM = /^\s*%%\s*$/;
const HEADING_LINE = /^(#{1,6})\s+(.+)$/;

function hasMapTag(app: App, file: TFile): boolean {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache) return false;
    const tags = getAllTags(cache);
    return tags?.some(t => t.toLowerCase() === '#mapa') ?? false;
}

function extractLinkPath(raw: string): string {
    return (raw.split('#')[0] ?? '').split('|')[0]?.trim() ?? '';
}

function collectEndOfDocumentLinks(lines: string[]): string[] {
    const paths: string[] = [];
    let i = lines.length - 1;

    while (i >= 0 && (lines[i] ?? '').trim() === '') i--;

    while (i >= 0) {
        const line = lines[i] ?? '';
        if (line.trim() === '') {
            i--;
            continue;
        }
        const match = BULLET_WIKILINK.exec(line);
        if (match) {
            const linkPath = extractLinkPath(match[1] ?? '');
            if (linkPath) paths.push(linkPath);
            i--;
        } else {
            break;
        }
    }
    return paths;
}

function collectBulletLinkPaths(content: string, options: LinkSearchOptions): string[] {
    const seen = new Set<string>();
    const add = (path: string) => { if (path) seen.add(path); };
    const lines = content.split('\n');

    if (options.sources.includes('comment-block')) {
        let inBlock = false;
        for (const line of lines) {
            if (COMMENT_BLOCK_DELIM.test(line)) {
                inBlock = !inBlock;
                continue;
            }
            if (!inBlock) continue;
            const match = BULLET_WIKILINK.exec(line);
            if (match) add(extractLinkPath(match[1] ?? ''));
        }
    }

    if (options.sources.includes('end-of-document')) {
        for (const path of collectEndOfDocumentLinks(lines)) {
            add(path);
        }
    }

    if (options.sources.includes('under-heading')) {
        const targetText = options.headingName.toLowerCase();
        let collecting = false;
        let headingLevel = 0;

        for (const line of lines) {
            const headingMatch = HEADING_LINE.exec(line);
            if (headingMatch) {
                const level = (headingMatch[1] ?? '').length;
                const text = (headingMatch[2] ?? '').trim().toLowerCase();
                if (!collecting) {
                    if (text === targetText) {
                        collecting = true;
                        headingLevel = level;
                    }
                } else if (level <= headingLevel) {
                    break;
                }
                continue;
            }

            if (!collecting) continue;
            const match = BULLET_WIKILINK.exec(line);
            if (match) add(extractLinkPath(match[1] ?? ''));
        }
    }

    return Array.from(seen);
}

function referencedAsBullet(content: string, targetBasename: string, options: LinkSearchOptions): boolean {
    for (const linkPath of collectBulletLinkPaths(content, options)) {
        if (linkPath === targetBasename || linkPath.endsWith('/' + targetBasename)) {
            return true;
        }
    }
    return false;
}

async function findBulletParents(app: App, file: TFile, options: LinkSearchOptions): Promise<TFile[]> {
    const parents: TFile[] = [];
    const allFiles = app.vault.getMarkdownFiles();

    for (const candidate of allFiles) {
        if (candidate.path === file.path) continue;
        const content = await app.vault.cachedRead(candidate);

        if (referencedAsBullet(content, file.basename, options)) {
            parents.push(candidate);
        }
    }
    return parents;
}

async function findMapRoot(app: App, file: TFile, options: LinkSearchOptions): Promise<TFile> {
    const visited = new Set<string>();
    let current = file;

    while (true) {
        const isMapa = hasMapTag(app, current);
        if (isMapa) return current;

        visited.add(current.path);
        const parents = await findBulletParents(app, current, options);
        const next = parents.find(p => !visited.has(p.path));

        if (!next) {
            return current;
        }
        current = next;
    }
}

export async function buildOutlineTree(
    app: App,
    rootFile: TFile,
    maxDepth: number,
    options: LinkSearchOptions,
): Promise<{ tree: OutlineNode; isMap: boolean }> {
    const visited = new Set<string>();
    const mapRoot = await findMapRoot(app, rootFile, options);
    const isMap = hasMapTag(app, mapRoot);
    const tree = await buildNode(app, mapRoot, maxDepth, visited, options);
    return { tree, isMap };
}

export async function ensureIndexedFrontmatter(app: App, filePaths: string[]): Promise<boolean> {
    let modified = false;
    for (const path of filePaths) {
        const file = app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            const cache = app.metadataCache.getFileCache(file);
            if (cache?.frontmatter?.['indexed'] !== true) {
                try {
                    await app.fileManager.processFrontMatter(file, (fm) => {
                        fm.indexed = true;
                    });
                    modified = true;
                } catch (e) {
                    // Fail silently to avoid interrupting the flow
                }
            }
        }
    }
    return modified;
}

async function buildNode(
    app: App,
    file: TFile,
    depth: number,
    visited: Set<string>,
    options: LinkSearchOptions,
): Promise<OutlineNode> {
    const node: OutlineNode = {
        file: file.path,
        name: file.basename,
        children: []
    };

    if (depth <= 0 || visited.has(file.path)) {
        return node;
    }
    visited.add(file.path);

    const content = await app.vault.cachedRead(file);
    const seen = new Set<string>();

    for (const linkPath of collectBulletLinkPaths(content, options)) {
        if (seen.has(linkPath)) continue;
        seen.add(linkPath);

        const linkedFile = app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
        if (linkedFile instanceof TFile) {
            node.children.push(await buildNode(app, linkedFile, depth - 1, visited, options));
        }
    }

    return node;
}

export function collectTreePaths(node: OutlineNode, out: Set<string> = new Set()): Set<string> {
    out.add(node.file);
    for (const child of node.children) {
        collectTreePaths(child, out);
    }
    return out;
}

export async function insertSubnote(
    app: App,
    targetNode: OutlineNode,
    parentNode: OutlineNode | null,
    droppedName: string,
    position: 'before' | 'after' | 'child'
) {
    let fileToModifyPath = position === 'child' ? targetNode.file : parentNode?.file;
    if (!fileToModifyPath) fileToModifyPath = targetNode.file; // Fallback to modifying self as child if no parent

    const fileToModify = app.vault.getAbstractFileByPath(fileToModifyPath);
    if (!(fileToModify instanceof TFile)) return;

    await app.vault.process(fileToModify, (data) => {
        if (position === 'child' || !parentNode) {
            const commentBlockRegex = /%%\n([\s\S]*?)\n%%/;
            if (commentBlockRegex.test(data)) {
                // Insert inside existing comment block
                return data.replace(commentBlockRegex, `%%\n$1\n- [[${droppedName}]]\n%%`);
            } else {
                // Append comment block at the end of file
                return data.trimEnd() + `\n\n%%\n- [[${droppedName}]]\n%%`;
            }
        } else {
            // Find the target node reference inside the parent document
            const lines = data.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i] ?? '';
                if (line.includes(`[[${targetNode.name}]]`) || line.includes(`[[${targetNode.name}|`)) {
                    const bulletMatch = line.match(/^(\s*[-*]\s+)/);
                    const prefix = bulletMatch ? bulletMatch[1] ?? '- ' : '- ';
                    const newEntry = `${prefix}[[${droppedName}]]`;

                    if (position === 'before') {
                        lines.splice(i, 0, newEntry);
                    } else {
                        lines.splice(i + 1, 0, newEntry);
                    }
                    break;
                }
            }
            return lines.join('\n');
        }
    });
}

/**
 * Removes the wikilink pointing to childBasename from the parent file.
 * Also removes any now-empty comment blocks left behind.
 * Optionally strips `indexed: true` from the removed note's frontmatter.
 */
export async function removeSubnote(
    app: App,
    parentNode: OutlineNode,
    childBasename: string,
    childFilePath?: string,
) {
    const fileToModify = app.vault.getAbstractFileByPath(parentNode.file);
    if (!(fileToModify instanceof TFile)) return;

    await app.vault.process(fileToModify, (data) => {
        const lines = data.split('\n');

        // Remove lines that are bullet wikilinks to childBasename
        const filtered = lines.filter(line => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('-')) return true;
            return !(trimmed.includes(`[[${childBasename}]]`) || trimmed.includes(`[[${childBasename}|`));
        });

        // Remove empty comment blocks: %% followed by nothing (or only whitespace lines) followed by %%
        const result: string[] = [];
        let i = 0;
        while (i < filtered.length) {
            const line = filtered[i] ?? '';
            if (COMMENT_BLOCK_DELIM.test(line)) {
                // Look ahead: collect lines until the closing %%
                let j = i + 1;
                while (j < filtered.length && !COMMENT_BLOCK_DELIM.test(filtered[j] ?? '')) {
                    j++;
                }
                // Lines between the two %% markers
                const interior = filtered.slice(i + 1, j);
                const hasContent = interior.some(l => l.trim() !== '');
                if (!hasContent) {
                    // Block is empty — skip the opening %%, interior, and closing %%
                    // Also eat a preceding blank line if present
                    if (result.length > 0 && (result[result.length - 1] ?? '').trim() === '') {
                        result.pop();
                    }
                    i = j + 1; // skip past closing %%
                } else {
                    // Non-empty block — keep it
                    result.push(line);
                    i++;
                }
            } else {
                result.push(line);
                i++;
            }
        }

        return result.join('\n');
    });

    // Strip indexed: true from the removed note, cleaning up empty frontmatter
    if (childFilePath) {
        const childFile = app.vault.getAbstractFileByPath(childFilePath);
        if (childFile instanceof TFile) {
            try {
                await app.fileManager.processFrontMatter(childFile, (fm) => {
                    delete fm['indexed'];
                });
                // If frontmatter is now empty, processFrontMatter will leave an empty block.
                // Remove it by rewriting the file directly.
                const raw = await app.vault.read(childFile);
                const emptyFrontmatter = /^---\r?\n---\r?\n?/;
                if (emptyFrontmatter.test(raw)) {
                    await app.vault.modify(childFile, raw.replace(emptyFrontmatter, ''));
                }
            } catch (_) {
                // Fail silently
            }
        }
    }
}

/**
 * Rewrites the wikilink order for direct children of a node inside the parent file.
 * newOrder is an array of child basenames in the desired sequence.
 */
export async function reorderSubnotes(
    app: App,
    parentNode: OutlineNode,
    newOrder: string[]
) {
    const fileToModify = app.vault.getAbstractFileByPath(parentNode.file);
    if (!(fileToModify instanceof TFile)) return;

    await app.vault.process(fileToModify, (data) => {
        const lines = data.split('\n');

        // Locate the line for each child basename (first match wins)
        const childLines = new Map<string, { idx: number; line: string }>();
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? '';
            for (const name of newOrder) {
                if (!childLines.has(name) &&
                    (line.includes(`[[${name}]]`) || line.includes(`[[${name}|`))) {
                    childLines.set(name, { idx: i, line });
                    break;
                }
            }
        }

        if (childLines.size === 0) return data;

        // Insertion point = position of the earliest matched line
        const allIdxDesc = Array.from(childLines.values())
            .map(v => v.idx)
            .sort((a, b) => b - a);
        const firstIdx = Math.min(...allIdxDesc);

        // Remove all matched lines in descending order to preserve lower indices
        for (const idx of allIdxDesc) {
            lines.splice(idx, 1);
        }

        // Insert in new order at the original first position
        const newLines = newOrder
            .map(name => childLines.get(name)?.line)
            .filter((l): l is string => l !== undefined);
        lines.splice(firstIdx, 0, ...newLines);

        return lines.join('\n');
    });
}