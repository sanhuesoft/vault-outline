export interface OutlineNode {
	file: string;    // vault-relative path
	name: string;    // basename without extension
	children: OutlineNode[];
}
