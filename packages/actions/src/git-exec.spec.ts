import { describe, expect, it } from "vitest";

import { classifyExecFailure, createGitExec } from "./git-exec.ts";

describe(createGitExec, () => {
	it("should run the real git binary and resolve its stdout with exit code 0", async () => {
		expect.assertions(2);

		const git = createGitExec();
		const result = await git(["--version"]);

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("git version");
	});

	it("should resolve a non-zero exit code when git reports an error", async () => {
		expect.assertions(2);

		const git = createGitExec();
		const result = await git(["not-a-real-subcommand"]);

		expect(result.code).not.toBe(0);
		expect(result.stderr).not.toBe("");
	});
});

describe(classifyExecFailure, () => {
	it("should pass a numeric exit code through with its captured output", () => {
		expect.assertions(1);

		const result = classifyExecFailure({ code: 7, stderr: "boom\n", stdout: "partial" });

		expect(result).toStrictEqual({ code: 7, stderr: "boom\n", stdout: "partial" });
	});

	it("should collapse a non-numeric launch errno to exit code 1", () => {
		expect.assertions(1);

		const result = classifyExecFailure({ code: "ENOENT", stderr: "", stdout: "" });

		expect(result.code).toBe(1);
	});

	it("should normalize absent stdout and stderr to empty strings", () => {
		expect.assertions(1);

		const result = classifyExecFailure({ code: 1 });

		expect(result).toStrictEqual({ code: 1, stderr: "", stdout: "" });
	});
});
