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

	it("should run git in the configured working directory", async () => {
		expect.assertions(1);

		const git = createGitExec({ cwd: "this-directory-does-not-exist-xyz" });
		const result = await git(["--version"]);

		expect(result.code).not.toBe(0);
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

	it("should surface the launch failure message as stderr when the process never ran", () => {
		expect.assertions(1);

		const result = classifyExecFailure({
			code: "ENOENT",
			message: "spawn git ENOENT",
			stderr: "",
			stdout: "",
		});

		expect(result.stderr).toBe("spawn git ENOENT");
	});

	it("should fall back to the errno when a launch failure carries no message", () => {
		expect.assertions(1);

		const result = classifyExecFailure({ code: "EACCES", stderr: "", stdout: "" });

		expect(result.stderr).toBe("EACCES");
	});

	it("should keep the captured stderr when a launch failure also produced output", () => {
		expect.assertions(1);

		const result = classifyExecFailure({
			code: "ENOENT",
			message: "spawn git ENOENT",
			stderr: "real output",
			stdout: "",
		});

		expect(result.stderr).toBe("real output");
	});

	it("should normalize absent stdout and stderr to empty strings", () => {
		expect.assertions(1);

		const result = classifyExecFailure({ code: 1 });

		expect(result).toStrictEqual({ code: 1, stderr: "", stdout: "" });
	});

	it("should normalize a launch failure with no message and no errno to an empty stderr", () => {
		expect.assertions(1);

		const result = classifyExecFailure({});

		expect(result).toStrictEqual({ code: 1, stderr: "", stdout: "" });
	});

	it("should classify a rejection value that is not an object as a launch failure", () => {
		expect.assertions(1);

		const result = classifyExecFailure("git blew up");

		expect(result).toStrictEqual({ code: 1, stderr: "", stdout: "" });
	});

	it("should classify a null rejection as a launch failure rather than reading fields off it", () => {
		expect.assertions(1);

		// `typeof null === "object"`, so the null check is what stops the field
		// reads from throwing here.
		// eslint-disable-next-line unicorn/no-null -- the rejection value under test is literally null
		const result = classifyExecFailure(null);

		expect(result).toStrictEqual({ code: 1, stderr: "", stdout: "" });
	});

	it("should ignore output fields that a rejection carries with a non-string type", () => {
		expect.assertions(1);

		const result = classifyExecFailure({ code: 3, stderr: 404, stdout: ["chunk"] });

		expect(result).toStrictEqual({ code: 3, stderr: "", stdout: "" });
	});
});
