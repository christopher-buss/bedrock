import { describe, it } from "vitest";

import { fixture } from "../tests/github-fixture.spec.ts";

function ownedFixture(override: object) {
	const result = fixture();
	result.responses["repos/owner/repo/pulls/2/files?per_page=100&page=1"] = [
		{ filename: ".changeset/renovate-pr-2.md", status: "added" },
	];
	result.responses["repos/owner/repo/contents/.changeset/renovate-pr-2.md?ref=merge"] = {
		content: btoa("generated"),
		encoding: "base64",
	};
	result.responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [{ sha: "writer" }];
	result.responses["repos/owner/repo/commits/writer?per_page=100"] = {
		author: { login: "writer[bot]" },
		commit: { verification: { reason: "valid", verified: true } },
		committer: { login: "web-flow" },
		files: [{ filename: ".changeset/renovate-pr-2.md" }],
		...override,
	};
	return result;
}

describe("gitHub snapshot boundaries", () => {
	it("should refuse writer-signed history that never touched the reserved path", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port } = ownedFixture({ files: [{ filename: "README.md" }] });
		const state = await port.read();

		expect(state.owned).toBe(false);
	});

	it.for([
		{ author: { login: "foreign" } },
		{ author: JSON.parse("null") },
		{ committer: { login: "foreign" } },
		{ commit: { verification: { reason: "valid", verified: false } } },
		{ commit: { verification: { reason: "unsigned", verified: true } } },
	])(
		"should independently verify writer authorship and GitHub signature",
		async (override, { expect }) => {
			expect.hasAssertions();

			const { port } = ownedFixture(override);
			const state = await port.read();

			expect(state.owned).toBe(false);
		},
	);

	it("should allow writer commits containing other files alongside the owned file", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port } = ownedFixture({
			files: [{ filename: "README.md" }, { filename: ".changeset/renovate-pr-2.md" }],
		});
		const state = await port.read();

		expect(state.owned).toBe(true);
	});

	it("should ignore non-intent Markdown, ledger files, README and deleted intents", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2/files?per_page=100&page=1"] = [
			{ filename: "README.md", status: "modified" },
			{ filename: ".changeset/README.md", status: "modified" },
			{ filename: ".changeset/ledger.yaml", status: "modified" },
			{ filename: ".changeset/removed.md", status: "removed" },
		];
		const state = await port.read();

		expect(state.input.humanIntents).toStrictEqual([]);
	});

	it("should read only blob manifests matching one workspace pattern at the correct depth", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		for (const sha of ["base", "merge"]) {
			responses[`repos/owner/repo/contents/pnpm-workspace.yaml?ref=${sha}`] = {
				content: btoa("packages: ['apps/*', 'packages/*']"),
				encoding: "base64",
			};
			responses[`repos/owner/repo/git/trees/${sha}?recursive=1`] = {
				tree: [
					{ path: "packages/core/package.json", type: "blob" },
					{ path: "packages/ignored/package.json", type: "tree" },
					{ path: "outside/core/package.json", type: "blob" },
					{ path: "packages/core/notes.md", type: "blob" },
					{ path: "packages/core/src/package.json", type: "blob" },
				],
				truncated: false,
			};
			responses[`repos/owner/repo/contents/packages/core/package.json?ref=${sha}`] = {
				content: btoa('{"name":"core","version":"0.1.0"}'),
				encoding: "base64",
			};
		}

		const state = await port.read();

		expect(state.input.head.packages).toStrictEqual({
			"packages/core": { name: "core", version: "0.1.0" },
		});
	});

	it("should retain file evidence found on a later verified commit page", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = ownedFixture({
			files: Array.from({ length: 100 }, () => ({ filename: "README.md" })),
		});
		responses["repos/owner/repo/commits/writer?per_page=100&page=2"] = {
			files: [{ filename: ".changeset/renovate-pr-2.md" }],
		};
		const state = await port.read();

		expect(state.owned).toBe(true);
	});
});
