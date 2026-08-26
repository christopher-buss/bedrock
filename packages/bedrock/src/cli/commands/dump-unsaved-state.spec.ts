import { describe, expect, it, vi } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import { gamePassCurrent } from "#tests/helpers/resources";
import type { ResourceCurrentState } from "../../core/resources.ts";
import { parseStateFile } from "../../core/state-file.ts";
import type { BedrockState } from "../../core/state.ts";
import type { DeployError } from "../../shell/deploy.ts";
import { asResourceKey } from "../../types/ids.ts";
import type { ClackPort } from "../render.ts";
import { dumpUnsavedStateAsync, type DumpUnsavedStateDeps } from "./dump-unsaved-state.ts";

type WriteFileFunc = DumpUnsavedStateDeps["writeFile"];
type MkdirFunc = DumpUnsavedStateDeps["mkdir"];

function passResource(key: string): ResourceCurrentState {
	return gamePassCurrent({ key: asResourceKey(key) });
}

function unsavedState(resources: ReadonlyArray<ResourceCurrentState>): BedrockState {
	return { environment: "production", resources, version: 1 };
}

function writeFailure(
	unrecorded: ReadonlyArray<ResourceCurrentState>,
): Extract<DeployError, { kind: "stateWriteFailed" }> {
	return {
		cause: { file: "gist:abc123", kind: "stateError", reason: "403 Forbidden" },
		kind: "stateWriteFailed",
		unrecorded,
		unsavedState: unsavedState(unrecorded),
	};
}

function makeDeps(overrides: Partial<DumpUnsavedStateDeps> = {}): DumpUnsavedStateDeps & {
	readonly clack: ClackPort;
} {
	return {
		clack: fakeClackPort(),
		mkdir: vi.fn<MkdirFunc>(async () => {}),
		projectRoot: "/repo",
		writeFile: vi.fn<WriteFileFunc>(async () => {}),
		...overrides,
	};
}

describe(dumpUnsavedStateAsync, () => {
	it("should write the unsaved state to the environment's recovery file", async () => {
		expect.assertions(2);

		const deps = makeDeps();

		await dumpUnsavedStateAsync(deps, {
			configFile: undefined,
			environment: "production",
			err: writeFailure([passResource("vip-pass")]),
		});

		expect(deps.mkdir).toHaveBeenCalledExactlyOnceWith("/repo/.bedrock/recovery");
		expect(deps.writeFile).toHaveBeenCalledExactlyOnceWith(
			"/repo/.bedrock/recovery/production.json",
			expect.any(String),
		);
	});

	it("should write state the push command can parse back", async () => {
		expect.assertions(1);

		const writes: Array<string> = [];
		const deps = makeDeps({
			writeFile: vi.fn<WriteFileFunc>(async (_path, contents) => {
				writes.push(contents);
			}),
		});

		await dumpUnsavedStateAsync(deps, {
			configFile: undefined,
			environment: "production",
			err: writeFailure([passResource("vip-pass")]),
		});

		expect(parseStateFile(writes[0], "dump")).toStrictEqual({
			data: unsavedState([passResource("vip-pass")]),
			success: true,
		});
	});

	it("should name the resources applied but not recorded", async () => {
		expect.assertions(1);

		const deps = makeDeps();

		await dumpUnsavedStateAsync(deps, {
			configFile: undefined,
			environment: "production",
			err: writeFailure([passResource("vip-pass"), passResource("alpha-pass")]),
		});

		expect(deps.clack.logError).toHaveBeenCalledWith(
			"applied but not recorded: gamePass.vip-pass, gamePass.alpha-pass",
		);
	});

	it("should stay silent about unrecorded resources when the failed write applied none", async () => {
		expect.assertions(1);

		const deps = makeDeps();

		await dumpUnsavedStateAsync(deps, {
			configFile: undefined,
			environment: "production",
			err: writeFailure([]),
		});

		expect(deps.clack.logError).not.toHaveBeenCalled();
	});

	it("should point at the command that pushes the dumped file", async () => {
		expect.assertions(1);

		const deps = makeDeps();

		await dumpUnsavedStateAsync(deps, {
			configFile: undefined,
			environment: "production",
			err: writeFailure([passResource("vip-pass")]),
		});

		expect(deps.clack.logMessage).toHaveBeenCalledExactlyOnceWith(
			"unsaved state written to /repo/.bedrock/recovery/production.json; push it with: bedrock state push --env production",
		);
	});

	it("should quote the run's own config path in the push command", async () => {
		expect.assertions(1);

		const deps = makeDeps();

		await dumpUnsavedStateAsync(deps, {
			configFile: "./bedrock.staging.config.ts",
			environment: "production",
			err: writeFailure([passResource("vip-pass")]),
		});

		expect(deps.clack.logMessage).toHaveBeenCalledExactlyOnceWith(
			"unsaved state written to /repo/.bedrock/recovery/production.json; push it with: bedrock state push --env production --config ./bedrock.staging.config.ts",
		);
	});

	it("should report the failure and skip the write when the recovery directory cannot be created", async () => {
		expect.assertions(2);

		const deps = makeDeps({
			mkdir: vi.fn<MkdirFunc>(async () => {
				throw new Error("EACCES");
			}),
		});

		await dumpUnsavedStateAsync(deps, {
			configFile: undefined,
			environment: "production",
			err: writeFailure([passResource("vip-pass")]),
		});

		expect(deps.writeFile).not.toHaveBeenCalled();
		expect(deps.clack.logError).toHaveBeenCalledWith(
			"unsaved state dump failed (/repo/.bedrock/recovery/production.json): EACCES",
		);
	});

	it("should report the failure when the recovery file cannot be written", async () => {
		expect.assertions(2);

		const deps = makeDeps({
			writeFile: vi.fn<WriteFileFunc>(async () => {
				throw new Error("ENOSPC");
			}),
		});

		await dumpUnsavedStateAsync(deps, {
			configFile: undefined,
			environment: "production",
			err: writeFailure([passResource("vip-pass")]),
		});

		expect(deps.clack.logError).toHaveBeenCalledWith(
			"unsaved state dump failed (/repo/.bedrock/recovery/production.json): ENOSPC",
		);
		expect(deps.clack.logMessage).not.toHaveBeenCalled();
	});
});
