import { App, TFile, getAllTags } from 'obsidian';
import { OutlineNode } from './types';

/**
 * Matches a bullet line that starts with a single wikilink, e.g.:
 *   - [[Note name]]
 *   - [[Note name#heading]]
 *   - [[Note name|alias]]
 *   - [[Note name]]: some description
 * Capture group 1 is the raw link target (may include #anchor or |alias).
 * NOTE: Links are only considered when they appear inside a comment block:
 * A comment block is a pair of lines containing only %% (start and end).
 */
const BULLET_WIKILINK = /^\s*-\s*\[\[([^\]]+)\]\]/;
const COMMENT_BLOCK_DELIM = /^\s*%%\s*$/;

/** Returns true if the file has the tag "mapa" (anywhere: frontmatter or inline). */
function hasMapTag(app: App, file: TFile): boolean {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return false;
	const tags = getAllTags(cache);
	return tags?.some(t => t.toLowerCase() === '#mapa') ?? false;
}

/**
 * Scans content to determine whether `targetBasename` is linked inside a %% block.
 * Used to find which files reference a given file as a bullet inside a comment block.
 */
function referencedInCommentBlock(content: string, targetBasename: string): boolean {
	let inBlock = false;
	for (const line of content.split('\n')) {
		if (COMMENT_BLOCK_DELIM.test(line)) { inBlock = !inBlock; continue; }
		if (!inBlock) continue;
		const match = BULLET_WIKILINK.exec(line);
		if (!match) continue;
		const raw = match[1] ?? '';
		const linkPath = (raw.split('#')[0] ?? '').split('|')[0]?.trim() ?? '';
		// Compare by basename or by full path segment
		if (linkPath === targetBasename || linkPath.endsWith('/' + targetBasename)) return true;
	}
	return false;
}

/**
 * Finds files that reference `file` as a bullet item inside a %% comment block.
 * Scans all markdown files because Obsidian does not index links inside %% blocks
 * in resolvedLinks (they are treated as hidden comments).
 */
async function findCommentBlockParents(app: App, file: TFile): Promise<TFile[]> {
	const parents: TFile[] = [];
	const allFiles = app.vault.getMarkdownFiles();
	console.log(`[vault-outline] findCommentBlockParents: scanning ${allFiles.length} files for references to "${file.basename}"`);
	for (const candidate of allFiles) {
		if (candidate.path === file.path) continue;
		const content = await app.vault.cachedRead(candidate);
		const found = referencedInCommentBlock(content, file.basename);
		if (found) {
			console.log(`[vault-outline] findCommentBlockParents: found reference in "${candidate.path}"`);
			parents.push(candidate);
		}
	}
	console.log(`[vault-outline] findCommentBlockParents: found ${parents.length} parent(s)`);
	return parents;
}

/**
 * Climbs the "map hierarchy" (via %% comment-block backlinks) until it finds
 * the nearest ancestor tagged `mapa` in its frontmatter.
 * Falls back to the original file if no such ancestor exists.
 */
async function findMapRoot(app: App, file: TFile): Promise<TFile> {
	const visited = new Set<string>();
	let current = file;
	console.log(`[vault-outline] findMapRoot: starting from "${file.basename}"`);

	while (true) {
		const isMapa = hasMapTag(app, current);
		console.log(`[vault-outline] findMapRoot: checking "${current.basename}" – hasMapTag=${isMapa}`);
		if (isMapa) return current;
		visited.add(current.path);

		const parents = await findCommentBlockParents(app, current);
		const next = parents.find(p => !visited.has(p.path));
		if (!next) {
			console.log(`[vault-outline] findMapRoot: no unvisited parent found, falling back to "${file.basename}"`);
			return file;
		}
		current = next;
	}
}

export async function buildOutlineTree(app: App, rootFile: TFile, maxDepth: number): Promise<OutlineNode> {
	const visited = new Set<string>();
	const mapRoot = await findMapRoot(app, rootFile);
	return buildNode(app, mapRoot, maxDepth, visited);
}

async function buildNode(app: App, file: TFile, depth: number, visited: Set<string>): Promise<OutlineNode> {
	const node: OutlineNode = { file: file.path, name: file.basename, children: [] };

	if (depth <= 0 || visited.has(file.path)) {
		return node;
	}

	visited.add(file.path);

	const content = await app.vault.cachedRead(file);
	const seen = new Set<string>();

	let inCommentBlock = false;
	for (const line of content.split('\n')) {
		// Toggle comment block state when encountering a delimiter line
		if (COMMENT_BLOCK_DELIM.test(line)) {
			inCommentBlock = !inCommentBlock;
			continue;
		}

		// Only process lines that are inside a comment block
		if (!inCommentBlock) continue;

		const match = BULLET_WIKILINK.exec(line);
		if (!match) continue;

		// Strip heading anchor and alias, keep only the path portion
		const raw = match[1] ?? '';
		const linkPath = (raw.split('#')[0] ?? '').split('|')[0]?.trim() ?? '';
		if (!linkPath || seen.has(linkPath)) continue;
		seen.add(linkPath);

		const linkedFile = app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
		if (linkedFile instanceof TFile) {
			node.children.push(await buildNode(app, linkedFile, depth - 1, visited));
		}
	}

	return node;
}

/** Collects all file paths present in the tree into a Set. */
export function collectTreePaths(node: OutlineNode, out: Set<string> = new Set()): Set<string> {
	out.add(node.file);
	for (const child of node.children) {
		collectTreePaths(child, out);
	}
	return out;
}

