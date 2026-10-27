import { ChildProcess, spawn } from "node:child_process";
import process from "node:process";
import { assert, describe, it, vi } from "vitest";

import { classifySpawnClose, createDefaultSpawner } from "./default-spawner.ts";

vi.mock(import("node:child_process"), { spy: true });

describe(createDefaultSpawner, () => {
	it("should report a child terminated by a signal as a launch failure", async ({ expect }) => {
		expect.assertions(1);

		const child = new ChildProcess();
		vi.mocked(spawn).mockReturnValueOnce(child);
		const pending = createDefaultSpawner().spawn({
			args: [],
			command: "build-tool",
			envOverrides: {},
		});
		// eslint-disable-next-line unicorn/no-null -- Node reports a signal-only termination with a null exit code.
		child.emit("close", null, "SIGTERM");
		const result = await pending;
		assert(!result.success);

		expect(result.err.cause.message).toBe("spawned process terminated by signal SIGTERM");
	});

	it("should resolve Ok(0) when the spawned command exits zero", async ({ expect }) => {
		expect.assertions(2);

		const spawner = createDefaultSpawner();
		const result = await spawner.spawn({
			args: ["-e", "process.exit(0)"],
			command: process.execPath,
			envOverrides: {},
		});

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toBe(0);
	});

	it("should propagate a non-zero exit code through Ok(exitCode)", async ({ expect }) => {
		expect.assertions(2);

		const spawner = createDefaultSpawner();
		const result = await spawner.spawn({
			args: ["-e", "process.exit(7)"],
			command: process.execPath,
			envOverrides: {},
		});

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toBe(7);
	});

	it("should resolve Err(launchFailed) with an ENOENT cause when the command does not exist", async ({
		expect,
	}) => {
		expect.assertions(3);

		const spawner = createDefaultSpawner();
		const result = await spawner.spawn({
			args: [],
			command: "definitely-not-a-real-command-xyz",
			envOverrides: {},
		});

		expect(result.success).toBeFalse();

		assert(!result.success);

		expect(result.err.kind).toBe("launchFailed");
		expect(result.err.cause.code).toBe("ENOENT");
	});
});

describe(classifySpawnClose, () => {
	it("should resolve Ok(code) when the child exits with a numeric code", ({ expect }) => {
		expect.assertions(2);

		const result = classifySpawnClose(0, undefined);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toBe(0);
	});

	it("should pass through any non-zero numeric exit code as Ok(code)", ({ expect }) => {
		expect.assertions(2);

		const result = classifySpawnClose(7, undefined);

		expect(result.success).toBeTrue();

		assert(result.success);

		expect(result.data).toBe(7);
	});

	it("should resolve Err(launchFailed) naming the signal when code is null and signal is set", ({
		expect,
	}) => {
		expect.assertions(3);

		const result = classifySpawnClose(undefined, "SIGTERM");

		expect(result.success).toBeFalse();

		assert(!result.success);

		expect(result.err.kind).toBe("launchFailed");
		expect(result.err.cause.message).toBe("spawned process terminated by signal SIGTERM");
	});

	it("should fall back to 'unknown' in the signal message when signal is null", ({ expect }) => {
		expect.assertions(2);

		const result = classifySpawnClose(undefined, undefined);

		expect(result.success).toBeFalse();

		assert(!result.success);

		expect(result.err.cause.message).toBe("spawned process terminated by signal unknown");
	});
});
