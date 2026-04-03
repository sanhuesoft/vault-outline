import { App, TFile } from 'obsidian';
import { OutlineNode } from './types';

/**
 * Matches a line that is ONLY a bullet + a single wikilink, e.g.:
 *   - [[Note name]]
 *   - [[Note name#heading]]
 *   - [[Note name|alias]]
 * Capture group 1 is the raw link target (may include #anchor or |alias).
 */
const BULLET_WIKILINK = /^\s*-\s*\[\[([^\]]+)\]\]\s*$/;

export async function buildOutlineTree(app: App, rootFile: TFile, maxDepth: number): Promise<OutlineNode> {
	const visited = new Set<string>();
	return buildNode(app, rootFile, maxDepth, visited);
}

async function buildNode(app: App, file: TFile, depth: number, visited: Set<string>): Promise<OutlineNode> {
	const node: OutlineNode = { file: file.path, name: file.basename, children: [] };

	if (depth <= 0 || visited.has(file.path)) {
		return node;
	}

	visited.add(file.path);

	const content = await app.vault.cachedRead(file);
	const seen = new Set<string>();

	for (const line of content.split('\n')) {
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

