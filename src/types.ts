export interface OutlineNode {
	file: string;    // vault-relative path
	name: string;    // basename without extension
	alias?: string;  // alias from the wikilink, e.g. [[Note|Alias]]
	children: OutlineNode[];
}
