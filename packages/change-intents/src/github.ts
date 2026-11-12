import { parseJSON, parseYAML } from "confbox";
import { Buffer } from "node:buffer";

import { treeChanges, workspaceManifest } from "./git-tree.ts";
import type { GithubConfig } from "./github-config.ts";
import { fileChanges, headConflict } from "./github-write.ts";
import { parseIntent, planIntents } from "./index.ts";
import type { Manifest, Snapshot } from "./index.ts";
import { MergePendingError, readReadyMergeAsync } from "./merge-pending.ts";
import { HeadChangedError } from "./reconcile.ts";
import type { IntentWrite, ReconcilePort, ReconcileState } from "./reconcile.ts";

interface Pull {
	base: { sha: string };
	changed_files: number;
	commits: number;
	head: { ref: string; repo: { full_name: string }; sha: string };
	merge_commit_sha: null | string;
	state: string;
	user: { login: string };
}

interface Commit {
	author: null | {
		login: string;
	};
	commit: {
		verification: {
			reason: string;
			verified: boolean;
		};
	};
	committer: null | {
		login: string;
	};
	files: Array<{
		filename: string;
	}>;
	parents: Array<{
		sha: string;
	}>;
	sha: string;
}

interface Tree {
	tree: Array<{
		path: string;
		sha: string;
		type: string;
	}>;
	truncated: boolean;
}

interface FileContent {
	content: string;
	encoding: string;
}

interface Change {
	filename: string;
	removed: boolean;
}

class GithubReader {
	private readonly config: GithubConfig;

	constructor(config: GithubConfig) {
		this.config = config;
	}

	public async fileAsync(sha: string, path: string): Promise<string> {
		const file = await this.jsonAsync<FileContent>(
			`repos/${this.config.repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`,
		);
		if (file.encoding !== "base64") {
			throw new Error(`Unsupported content encoding for ${path}`);
		}

		return Buffer.from(file.content, "base64").toString("utf8");
	}

	public async jsonAsync<T>(path: string, body?: object): Promise<T> {
		const response = await (this.config.request ?? fetch)(`https://api.github.com/${path}`, {
			headers: {
				"Accept": "application/vnd.github+json",
				"Authorization": `Bearer ${this.config.token}`,
				"Content-Type": "application/json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			method: body === undefined ? "GET" : "POST",
			...(body === undefined ? {} : { body: String(JSON.stringify(body)) }),
		});
		if (!response.ok) {
			throw new Error(`GitHub request failed: ${response.status} ${path}`);
		}

		return parseJSON<T>(await response.text());
	}

	public async snapshotAsync(sha: string): Promise<Snapshot & { tree: Tree["tree"] }> {
		const tree = await this.jsonAsync<Tree>(
			`repos/${this.config.repository}/git/trees/${sha}?recursive=1`,
		);
		if (tree.truncated) {
			throw new Error("GitHub tree truncated; refusing incomplete snapshot");
		}

		const workspace = parseYAML<Snapshot["workspace"] & { packages: Array<string> }>(
			await this.fileAsync(sha, "pnpm-workspace.yaml"),
		);
		const manifests = tree.tree.filter((entry) => {
			return (
				entry.type === "blob" &&
				workspace.packages.some((glob) => workspaceManifest(glob, entry.path))
			);
		});
		const packages = await Promise.all(
			manifests.map(async ({ path }) => {
				const manifest = parseJSON<Manifest>(await this.fileAsync(sha, path));
				return [path.slice(0, -13), manifest] as const;
			}),
		);
		return { packages: Object.fromEntries(packages), tree: tree.tree, workspace };
	}
}

/**
 * Creates a port that never checks out or executes PR content.
 * @param config - Trusted repository credentials and transport.
 * @returns The immutable reader and conditional writer.
 */
export function createGithubPort(config: GithubConfig): ReconcilePort {
	const reader = new GithubReader(config);
	return {
		read: async () => readReadyMergeAsync(async () => readStateAsync({ config, reader })),
		write: async (change) => writeAsync({ config, reader }, change),
	};
}

async function commitFilesAsync(
	reader: GithubReader,
	input: { first: Commit["files"]; prefix: string; sha: string },
): Promise<Commit["files"]> {
	const files = [...input.first];
	if (files.length < 100) {
		return files;
	}

	for (let page = 2; page <= 30; page += 1) {
		const commit = await reader.jsonAsync<Commit>(
			`${input.prefix}/commits/${input.sha}?per_page=100&page=${page}`,
		);
		files.push(...commit.files);
		if (commit.files.length < 100) {
			return files;
		}
	}

	throw new Error("Commit file pagination exceeded safe limit");
}

function writerCommit(commit: Commit, login: string): boolean {
	return (
		commit.author?.login === login &&
		commit.committer?.login === "web-flow" &&
		commit.commit.verification.verified &&
		commit.commit.verification.reason === "valid"
	);
}

async function historyAsync(reader: GithubReader, resource: string): Promise<Array<Commit>> {
	const entries: Array<Commit> = [];
	for (let page = 1; page <= 100; page += 1) {
		const batch = await reader.jsonAsync<{ commits: Array<Commit> }>(
			`${resource}?per_page=100&page=${page}`,
		);
		entries.push(...batch.commits);
		if (batch.commits.length < 100) {
			return entries;
		}
	}

	throw new Error("GitHub pagination exceeded safe limit");
}

async function ownershipAsync(
	{ config, reader }: { config: GithubConfig; reader: GithubReader },
	{
		changed,
		path,
		present,
	}: { changed: { base: string; head: string }; path: string; present: boolean },
): Promise<boolean> {
	const prefix = `repos/${config.repository}`;
	const commits = await historyAsync(
		reader,
		`${prefix}/compare/${changed.base}...${changed.head}`,
	);
	let touched = false;
	for (const entry of commits) {
		const commit = await reader.jsonAsync<Commit>(
			`${prefix}/commits/${entry.sha}?per_page=100`,
		);
		commit.files = await commitFilesAsync(reader, {
			first: commit.files,
			prefix,
			sha: entry.sha,
		});
		if (commit.files.some(({ filename }) => filename === path)) {
			touched = true;
			if (!writerCommit(commit, config.writerLogin)) {
				return false;
			}
		}
	}

	return touched || !present;
}

async function humanIntentsAsync(
	reader: GithubReader,
	state: { files: Array<Change>; merge: string; ownedPath: string },
): Promise<Array<Record<string, string>>> {
	const files = state.files.filter((file) => {
		return (
			file.filename.startsWith(".changeset/") &&
			file.filename.endsWith(".md") &&
			file.filename !== state.ownedPath &&
			file.filename !== ".changeset/README.md" &&
			!file.removed
		);
	});
	return Promise.all(
		files.map(async ({ filename }) => {
			return parseIntent(await reader.fileAsync(state.merge, filename));
		}),
	);
}

async function snapshotStateAsync(
	{ config, reader }: { config: GithubConfig; reader: GithubReader },
	{ merge, parents, pull }: { merge: string; parents: Array<string>; pull: Pull },
): Promise<ReconcileState> {
	const [base, head] = await Promise.all([
		reader.snapshotAsync(pull.base.sha),
		reader.snapshotAsync(merge),
	]);
	const files = treeChanges(base.tree, head.tree);
	const ownedPath = `.changeset/renovate-pr-${config.number}.md`;
	const paths = files.map(({ filename }) => filename);
	const humanIntents = await humanIntentsAsync(reader, { files, merge, ownedPath });
	const exists = head.tree.some(({ path }) => path === ownedPath);
	const actual = exists ? await reader.fileAsync(merge, ownedPath) : undefined;
	const trusted = await ownershipAsync(
		{ config, reader },
		{ changed: { base: pull.base.sha, head: pull.head.sha }, path: ownedPath, present: exists },
	);
	const input = { base, head, humanIntents, number: config.number, paths };
	const handoff = !exists && humanIntents.length > 0 && planIntents(input).content === undefined;
	const owned = trusted || handoff;
	return {
		actual,
		base: pull.base.sha,
		head: pull.head.sha,
		input: { base, head, humanIntents, number: config.number, paths },
		mergeParents: parents,
		owned,
	};
}

async function readStateAsync({
	config,
	reader,
}: {
	config: GithubConfig;
	reader: GithubReader;
}): Promise<ReconcileState> {
	const prefix = `repos/${config.repository}`;
	const pull = await reader.jsonAsync<Pull>(`${prefix}/pulls/${config.number}`);
	if (pull.changed_files > 3000 || pull.commits > 250) {
		throw new Error("PR exceeds complete REST enumeration limits; record human intents");
	}

	if (
		pull.user.login !== "renovate[bot]" ||
		pull.head.repo.full_name !== config.repository ||
		pull.state !== "open"
	) {
		throw new Error("Writer requires an open same-repository Renovate PR");
	}

	if (pull.merge_commit_sha === null) {
		throw new MergePendingError("GitHub has no test merge; retry later");
	}

	const merge = await reader.jsonAsync<Commit>(`${prefix}/commits/${pull.merge_commit_sha}`);
	const parents = merge.parents.map(({ sha }) => sha);
	if (parents.length !== 2 || parents[0] !== pull.base.sha || parents[1] !== pull.head.sha) {
		throw new MergePendingError("GitHub test merge is stale");
	}

	return snapshotStateAsync({ config, reader }, { merge: pull.merge_commit_sha, parents, pull });
}

async function writeAsync(
	{ config, reader }: { config: GithubConfig; reader: GithubReader },
	change: IntentWrite,
): Promise<void> {
	const pull = await reader.jsonAsync<Pull>(`repos/${config.repository}/pulls/${config.number}`);
	if (pull.head.sha !== change.head) {
		throw new HeadChangedError("PR head changed before signed commit");
	}

	const result = await reader.jsonAsync<{
		errors?: Array<{ message: string; path?: Array<string>; type?: string }>;
	}>("graphql", {
		query: "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }",
		variables: {
			input: {
				branch: { branchName: pull.head.ref, repositoryNameWithOwner: config.repository },
				expectedHeadOid: change.head,
				fileChanges: fileChanges(change),
				message: { headline: "chore(deps): record dependency change intents" },
			},
		},
	});
	if (result.errors !== undefined) {
		const message = result.errors.map((error) => error.message).join("\n");
		if (headConflict(result.errors)) {
			throw new HeadChangedError(message);
		}

		throw new Error(message);
	}
}
