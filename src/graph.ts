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
): Promise<OutlineNode> {
    const visited = new Set<string>();
    const mapRoot = await findMapRoot(app, rootFile, options);
    
    const tree = await buildNode(app, mapRoot, maxDepth, visited, options);
    return tree;
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