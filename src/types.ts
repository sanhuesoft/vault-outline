export interface OutlineNode {
	file: string;      // vault-relative path; empty string for virtual nodes
	name: string;      // basename without extension; label for virtual nodes
	alias?: string;    // alias from the wikilink, e.g. [[Note|Alias]]
	virtual?: boolean; // true for grouping nodes that have no backing file
	children: OutlineNode[];
}
