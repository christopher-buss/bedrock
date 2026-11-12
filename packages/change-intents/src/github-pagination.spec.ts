import { describe, it } from "vitest";

import { fixture } from "../tests/github-fixture.spec.ts";

describe("bounded GitHub pagination", () => {
	it("should accept a terminating batch at the last supported page", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		for (let page = 1; page < 100; page += 1) {
			responses[`repos/owner/repo/pulls/2/files?per_page=100&page=${page}`] = Array.from(
				{ length: 100 },
				() => ({ filename: "README.md", status: "modified" }),
			);
		}

		responses["repos/owner/repo/pulls/2/files?per_page=100&page=100"] = [];
		const state = await port.read();

		expect(state.input.paths).toStrictEqual(["README.md"]);
	});

	it("should inspect the final supported commit-file page for provenance", async ({ expect }) => {
		expect.hasAssertions();

		const { port, responses } = fixture();
		responses["repos/owner/repo/pulls/2/files?per_page=100&page=1"] = [
			{ filename: ".changeset/renovate-pr-2.md", status: "added" },
		];
		responses["repos/owner/repo/contents/.changeset/renovate-pr-2.md?ref=merge"] = {
			content: btoa("generated"),
			encoding: "base64",
		};
		responses["repos/owner/repo/pulls/2/commits?per_page=100&page=1"] = [{ sha: "writer" }];
		const commit = {
			author: { login: "writer[bot]" },
			commit: { verification: { reason: "valid", verified: true } },
			committer: { login: "web-flow" },
			files: Array.from({ length: 100 }, () => ({ filename: "README.md" })),
		};
		responses["repos/owner/repo/commits/writer?per_page=100"] = commit;
		for (let page = 2; page < 30; page += 1) {
			responses[`repos/owner/repo/commits/writer?per_page=100&page=${page}`] = commit;
		}

		responses["repos/owner/repo/commits/writer?per_page=100&page=30"] = {
			...commit,
			files: [{ filename: ".changeset/renovate-pr-2.md" }],
		};
		const state = await port.read();

		expect(state.owned).toBe(true);
	});
});
