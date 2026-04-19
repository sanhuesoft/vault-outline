import { App, TFile, getAllTags } from 'obsidian';
import { LinkSearchOptions } from './settings';
import { OutlineNode } from './types';

/**
 * Matches a bullet line that starts with a wikilink, e.g.:
 *   - [[Note name]]
 *   - [[Note name#heading]]
 *   - [[Note name|alias]]
 *   - [[Note name]]: some description
 * Capture group 1 is the raw link target (may include #anchor or |alias).
 */
const BULLET_WIKILINK = /^\s*-\s*\[\[([^\]]+)\]\]/;
const COMMENT_BLOCK_DELIM = /^\s*%%\s*$/;
/** Matches a Markdown heading line. Group 1 = `#` characters, group 2 = heading text. */
const HEADING_LINE = /^(#{1,6})\s+(.+)$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if the file has the tag "mapa" (anywhere: frontmatter or inline). */
function hasMapTag(app: App, file: TFile): boolean {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return false;
	const tags = getAllTags(cache);
	return tags?.some(t => t.toLowerCase() === '#mapa') ?? false;
}

/** Extracts the link path (basename or vault-relative path) from a raw wikilink target. */
function extractLinkPath(raw: string): string {
	return (raw.split('#')[0] ?? '').split('|')[0]?.trim() ?? '';
}

/**
 * Scans `lines` backward from the end of the document and returns wikilink
 * paths from the last trailing bullet-list block. Blank lines within the block
 * are allowed; the scan stops at the first non-blank, non-bullet line.
 */
function collectEndOfDocumentLinks(lines: string[]): string[] {
	const paths: string[] = [];
	let i = lines.length - 1;
	// Skip trailing blank lines.
	while (i >= 0 && (lines[i] ?? '').trim() === '') i--;
	// Collect bullets, tolerating blank lines between them.
	while (i >= 0) {
		const line = lines[i] ?? '';
		if (line.trim() === '') { i--; continue; }
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

/**
 * Collects the unique link paths of all bullet wikilinks in `content` that are
 * eligible under the active `options.sources`. Results from all enabled sources
 * are merged and deduplicated.
 *
 * Sources:
 * - `comment-block`   – lines inside `%% … %%` blocks.
 * - `end-of-document` – the last trailing bullet-list block of the note.
 * - `under-heading`   – lines below the heading matching `options.headingName`.
 */
function collectBulletLinkPaths(content: string, options: LinkSearchOptions): string[] {
	const seen = new Set<string>();
	const add = (path: string) => { if (path) seen.add(path); };
	const lines = content.split('\n');

	if (options.sources.includes('comment-block')) {
		let inBlock = false;
		for (const line of lines) {
			if (COMMENT_BLOCK_DELIM.test(line)) { inBlock = !inBlock; continue; }
			if (!inBlock) continue;
			const match = BULLET_WIKILINK.exec(line);
			if (match) add(extractLinkPath(match[1] ?? ''));
		}
	}

	if (options.sources.includes('end-of-document')) {
		for (const path of collectEndOfDocumentLinks(lines)) add(path);
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
					if (text === targetText) { collecting = true; headingLevel = level; }
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

/**
 * Returns true if `targetBasename` appears as a bullet wikilink in `content`
 * under the rules defined by `options`.
 */
function referencedAsBullet(
	content: string,
	targetBasename: string,
	options: LinkSearchOptions,
): boolean {
	for (const linkPath of collectBulletLinkPaths(content, options)) {
		if (linkPath === targetBasename || linkPath.endsWith('/' + targetBasename)) return true;
	}
	return false;
}

/**
 * Finds all files that reference `file` as a bullet wikilink, according to
 * `options`. Always scans vault-wide because Obsidian does not index links
 * inside `%%` blocks in `resolvedLinks`.
 */
async function findBulletParents(
	app: App,
	file: TFile,
	options: LinkSearchOptions,
): Promise<TFile[]> {
	const parents: TFile[] = [];
	const allFiles = app.vault.getMarkdownFiles();
	console.log(`[vault-outline] findBulletParents(${options.sources.join('+')}): scanning ${allFiles.length} files for references to "${file.basename}"`);
	for (const candidate of allFiles) {
		if (candidate.path === file.path) continue;
		const content = await app.vault.cachedRead(candidate);
		if (referencedAsBullet(content, file.basename, options)) {
			console.log(`[vault-outline] findBulletParents: found reference in "${candidate.path}"`);
			parents.push(candidate);
		}
	}
	console.log(`[vault-outline] findBulletParents: found ${parents.length} parent(s)`);
	return parents;
}

// ---------------------------------------------------------------------------
// Map-root resolution
// ---------------------------------------------------------------------------

/**
 * Climbs the bullet-link hierarchy until it finds the nearest ancestor tagged
 * `#mapa`. Falls back to the topmost reachable ancestor when none is tagged.
 */
async function findMapRoot(app: App, file: TFile, options: LinkSearchOptions): Promise<TFile> {
	const visited = new Set<string>();
	let current = file;
	console.log(`[vault-outline] findMapRoot: starting from "${file.basename}"`);

	while (true) {
		const isMapa = hasMapTag(app, current);
		console.log(`[vault-outline] findMapRoot: checking "${current.basename}" – hasMapTag=${isMapa}`);
		if (isMapa) return current;
		visited.add(current.path);

		const parents = await findBulletParents(app, current, options);
		const next = parents.find(p => !visited.has(p.path));
		if (!next) {
			console.log(`[vault-outline] findMapRoot: no unvisited parent found, using topmost ancestor "${current.basename}"`);
			return current;
		}
		current = next;
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function buildOutlineTree(
	app: App,
	rootFile: TFile,
	maxDepth: number,
	options: LinkSearchOptions,
): Promise<OutlineNode> {
	const visited = new Set<string>();
	const mapRoot = await findMapRoot(app, rootFile, options);
	return buildNode(app, mapRoot, maxDepth, visited, options);
}

async function buildNode(
	app: App,
	file: TFile,
	depth: number,
	visited: Set<string>,
	options: LinkSearchOptions,
): Promise<OutlineNode> {
	const node: OutlineNode = { file: file.path, name: file.basename, children: [] };

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

/** Collects all file paths present in the tree into a Set. */
export function collectTreePaths(node: OutlineNode, out: Set<string> = new Set()): Set<string> {
	out.add(node.file);
	for (const child of node.children) {
		collectTreePaths(child, out);
	}
	return out;
}

