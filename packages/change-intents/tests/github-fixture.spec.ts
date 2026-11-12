import { parseJSON } from "confbox";

import { createGithubPort } from "../src/github.ts";

/** An open same-repository Renovate PR. */
export const pull = {
	base: { sha: "base" },
	head: { ref: "renovate/test", repo: { full_name: "owner/repo" }, sha: "head" },
	merge_commit_sha: "merge",
	state: "open",
	user: { login: "renovate[bot]" },
};

/**
 * Create an isolated GitHub transport fixture.
 * @returns The port, captured requests and configurable wire responses.
 */
export function fixture() {
	const requests: Array<{
		/** Serialized HTTP request payload. */
		body: string | undefined;
		/** HTTP request options. */
		init: RequestInit;
		/** Repository-relative HTTP resource. */
		path: string;
	}> = [];
	const responses: Record<string, object> = {
		"graphql": { data: { createCommitOnBranch: { commit: { oid: "new" } } } },
		"repos/owner/repo/commits/merge": { parents: [{ sha: "base" }, { sha: "head" }] },
		"repos/owner/repo/contents/pnpm-workspace.yaml?ref=base": {
			content: btoa("packages: []"),
			encoding: "base64",
		},
		"repos/owner/repo/contents/pnpm-workspace.yaml?ref=merge": {
			content: btoa("packages: []"),
			encoding: "base64",
		},
		"repos/owner/repo/git/trees/base?recursive=1": { tree: [], truncated: false },
		"repos/owner/repo/git/trees/merge?recursive=1": { tree: [], truncated: false },
		"repos/owner/repo/pulls/2": pull,
		"repos/owner/repo/pulls/2/files?per_page=100&page=1": [],
	};
	const port = createGithubPort({
		number: 2,
		repository: "owner/repo",
		request: async (input, init) => {
			const path = input.slice("https://api.github.com/".length);
			requests.push({
				body: typeof init.body === "string" ? init.body : undefined,
				init,
				path,
			});
			let response = responses[path];
			response = path.includes("/git/trees/") ? fixtureTree(responses, path) : response;

			if (path.includes("/compare/base...head?")) {
				response = {
					commits:
						responses[path.replace("/compare/base...head?", "/pulls/2/commits?")] ?? [],
				};
			}

			return Response.json(response ?? {}, {
				status: response === undefined ? 404 : 200,
			});
		},
		token: "test",
		writerLogin: "writer[bot]",
	});
	return { port, requests, responses };
}

/**
 * Configure a pull request with one human intent.
 * @param body - Intent Markdown returned by GitHub.
 * @returns The configured transport fixture.
 */
export function humanFixture(body: string) {
	const result = fixture();
	result.responses["repos/owner/repo/pulls/2/files?per_page=100&page=1"] = [
		{ filename: ".changeset/human.md", status: "added" },
	];
	result.responses["repos/owner/repo/contents/.changeset/human.md?ref=merge"] = {
		content: btoa(body),
		encoding: "base64",
	};
	return result;
}

function fixtureTree(responses: Record<string, object>, resource: string): object {
	const tree = parseJSON<{
		tree: Array<{ path: string; sha?: string; type: string }>;
		truncated: boolean;
	}>(String(JSON.stringify(responses[resource])));
	const merged = resource.includes("/merge?");
	const changes = Object.entries(responses)
		.filter(([key]) => key.includes("/pulls/2/files?"))
		.flatMap(([, value]) => {
			return parseJSON<Array<{ filename: string; status: string }>>(
				String(JSON.stringify(value)),
			);
		});
	const entries = tree.tree.map((entry) => {
		return {
			...entry,
			sha:
				entry.sha ??
				JSON.stringify(
					responses[
						`repos/owner/repo/contents/${entry.path}?ref=${merged ? "merge" : "base"}`
					],
				),
		};
	});
	for (const change of changes) {
		if (
			!(merged ? change.status === "removed" : change.status === "added") &&
			entries.every((entry) => entry.path !== change.filename)
		) {
			entries.push({
				path: change.filename,
				sha: merged ? "changed" : "original",
				type: "blob",
			});
		}
	}

	return { ...tree, tree: entries };
}
