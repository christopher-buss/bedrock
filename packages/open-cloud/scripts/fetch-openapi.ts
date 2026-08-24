import { applySchemaPatches, verifyPatchesStillNeeded } from "./apply-schema-patches.ts";

const UPSTREAM_PATH = "content/en-us/reference/cloud/openapi.json";
const UPSTREAM_RAW = `https://raw.githubusercontent.com/Roblox/creator-docs/refs/heads/main/${UPSTREAM_PATH}`;
const UPSTREAM_COMMITS_API = `https://api.github.com/repos/Roblox/creator-docs/commits?path=${encodeURIComponent(UPSTREAM_PATH)}&per_page=1`;
const README_PATH = "vendor/README.md";
const SPEC_PATH = "vendor/roblox-openapi.json";
const PINNED_COMMIT_PATTERN = /^\*\*Pinned commit:\*\* `[0-9a-f]{40}`$/m;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Object.prototype.toString.call(value) === "[object Object]";
}

async function fetchLatestSha(): Promise<string> {
	const response = await fetch(UPSTREAM_COMMITS_API, {
		headers: { accept: "application/vnd.github+json" },
	});
	if (!response.ok) {
		throw new Error(`failed to fetch upstream commit sha: ${String(response.status)}`);
	}

	// `Response.json()` is typed `any` by the DOM lib, so the boundary is
	// declared `unknown` and narrowed below.
	const commits: unknown = await response.json();
	const latest: unknown = Array.isArray(commits) ? commits[0] : undefined;
	const sha = isRecord(latest) ? latest["sha"] : undefined;
	if (typeof sha !== "string") {
		throw new Error("upstream commits api returned no results");
	}

	return sha;
}

async function refreshSpec(): Promise<void> {
	const specResponse = await fetch(UPSTREAM_RAW);
	if (!specResponse.ok) {
		throw new Error(`failed to fetch upstream openapi.json: ${String(specResponse.status)}`);
	}

	await Bun.write(SPEC_PATH, specResponse);
}

async function refreshAndPatchSpec(): Promise<void> {
	await refreshSpec();
	await verifyPatchesStillNeeded();
	await applySchemaPatches();
}

async function refreshPinnedCommit(): Promise<void> {
	const sha = await fetchLatestSha();
	const readme = await Bun.file(README_PATH).text();
	if (!PINNED_COMMIT_PATTERN.test(readme)) {
		throw new Error(`failed to locate pinned-commit line in ${README_PATH}`);
	}

	// A replacer function inserts the text verbatim; a string replacement would
	// interpret `$&` and friends in the interpolated value. The replace is a
	// no-op (not an error) when the pinned sha is already current.
	const updated = readme.replace(PINNED_COMMIT_PATTERN, () => `**Pinned commit:** \`${sha}\``);
	if (updated !== readme) {
		await Bun.write(README_PATH, updated);
	}
}

await Promise.all([refreshAndPatchSpec(), refreshPinnedCommit()]);
