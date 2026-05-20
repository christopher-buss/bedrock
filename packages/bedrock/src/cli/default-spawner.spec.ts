import process from "node:process";
import { assert, describe, expect, it } from "vitest";

import { createDefaultSpawner } from "./default-spawner.ts";

describe(createDefaultSpawner, () => {
	it("should resolve Ok(0) when the spawned command exits zero", async () => {
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

	it("should propagate a non-zero exit code through Ok(exitCode)", async () => {
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

	it("should resolve Err(launchFailed) with an ENOENT cause when the command does not exist", async () => {
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
