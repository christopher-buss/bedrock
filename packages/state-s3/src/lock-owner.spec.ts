import { describe, expect, it } from "vitest";

import { lockOwnerFrom } from "./lock-owner.ts";

/**
 * Read variables out of a fixed table, so no test depends on the ambient
 * environment of the machine running it.
 *
 * @param variables - What the environment holds.
 * @returns The reader to hand the owner.
 */
function environmentOf(variables: Readonly<Record<string, string>>) {
	return (name: string): string | undefined => variables[name];
}

describe(lockOwnerFrom, () => {
	it("should record the owner a team declared for itself", () => {
		expect.assertions(1);

		const owner = lockOwnerFrom(
			environmentOf({
				BEDROCK_LOCK_OWNER: "buildkite-agent-3",
				GITHUB_RUN_ID: "12345",
				USER: "ada",
			}),
		);

		expect(owner).toBe("buildkite-agent-3");
	});

	it("should record a github actions run as the url that leads to the job", () => {
		expect.assertions(1);

		const owner = lockOwnerFrom(
			environmentOf({
				GITHUB_REPOSITORY: "christopher-buss/bedrock",
				GITHUB_RUN_ID: "12345",
				USER: "runner",
			}),
		);

		expect(owner).toBe("https://github.com/christopher-buss/bedrock/actions/runs/12345");
	});

	it.for([
		["missing from the environment", {}],
		["blank", { GITHUB_REPOSITORY: "" }],
	] as const)("should still name the run when the repository is %s", ([, repo]) => {
		expect.assertions(1);

		expect(lockOwnerFrom(environmentOf({ ...repo, GITHUB_RUN_ID: "12345" }))).toBe(
			"https://github.com/unknown/actions/runs/12345",
		);
	});

	it.for([
		["USER", { USER: "ada" }],
		["USERNAME", { USERNAME: "ada" }],
	] as const)("should fall back to the local user named by %s", ([, variables]) => {
		expect.assertions(1);

		expect(lockOwnerFrom(environmentOf(variables))).toBe("ada");
	});

	it("should still name something when the environment names nobody", () => {
		expect.assertions(1);

		expect(lockOwnerFrom(environmentOf({}))).toBe("unknown");
	});

	it.for([
		["BEDROCK_LOCK_OWNER", { BEDROCK_LOCK_OWNER: "", USER: "ada" }, "ada"],
		["GITHUB_RUN_ID", { GITHUB_RUN_ID: "", USER: "ada" }, "ada"],
		["USER", { USER: "", USERNAME: "ada" }, "ada"],
		["USERNAME", { USER: "", USERNAME: "" }, "unknown"],
	] as const)(
		"should read a blank %s as absent rather than as an owner",
		([, variables, owner]) => {
			expect.assertions(1);

			expect(lockOwnerFrom(environmentOf(variables))).toBe(owner);
		},
	);
});
