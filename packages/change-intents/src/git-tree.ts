/** A blob or subtree at an immutable Git revision. */
export interface TreeEntry {
	/** Repository-relative path. */
	path: string;
	/** Immutable Git object identity. */
	sha: string;
	/** Git tree entry kind. */
	type: string;
}

/** A changed path derived from two immutable trees. */
interface Change {
	filename: string;
	removed: boolean;
}
/**
 * Compare pinned blob identities, including deletions.
 * @param base - Base entries.
 * @param head - Merged entries.
 * @returns Changed paths.
 */
export function treeChanges(base: Array<TreeEntry>, head: Array<TreeEntry>): Array<Change> {
	const before = new Map(base.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
	const after = new Map(head.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
	return [...new Set([...before.keys(), ...after.keys()])]
		.filter((path) => before.get(path) !== after.get(path))
		.map((filename) => ({ filename, removed: !after.has(filename) }));
}

const WORKSPACE_GLOB = /^[\w/-]+\/\*$/;

/**
 * Match the supported workspace-directory pattern.
 * @param glob - Workspace pattern.
 * @param path - Repository file path.
 * @returns Whether the path is a workspace manifest.
 */
export function workspaceManifest(glob: string, path: string): boolean {
	if (!WORKSPACE_GLOB.test(glob)) {
		throw new Error(`Unsupported workspace pattern: ${glob}`);
	}

	const prefix = glob.slice(0, -1);
	return (
		path.startsWith(prefix) &&
		path.endsWith("/package.json") &&
		path.slice(prefix.length).split("/").length === 2
	);
}
