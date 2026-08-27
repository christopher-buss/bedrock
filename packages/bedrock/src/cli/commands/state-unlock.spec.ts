import type { Result } from "@bedrock-rbx/ocale";

import { describe, expect, it, vi } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import type { ConfigError } from "../../core/config-error.ts";
import { EMPTY_PLUGIN_REGISTRY } from "../../core/plugin-registry.ts";
import type { Config } from "../../core/schema.ts";
import type {
	ForceReleaseStateLockError,
	ForceReleaseStateLockOutcome,
} from "../../shell/force-release-state-lock.ts";
import type { ProgDeps as ProgDependencies } from "../index.ts";
import { stateUnlockCommand } from "./state-unlock.ts";

type ExitFunc = NonNullable<ProgDependencies["exit"]>;
type ForceReleaseFunc = NonNullable<ProgDependencies["forceReleaseStateLock"]>;
type LoadProjectFunc = NonNullable<ProgDependencies["loadProject"]>;

const SAMPLE_CONFIG: Config = {
	environments: { production: {}, staging: {} },
	state: { backend: "s3", bucket: "my-bucket" },
};

function fakeLoad(result?: Result<Config, ConfigError>): LoadProjectFunc {
	const loaded = result ?? { data: SAMPLE_CONFIG, success: true };
	return vi.fn<LoadProjectFunc>(async () => {
		return loaded.success
			? { data: { config: loaded.data, plugins: EMPTY_PLUGIN_REGISTRY }, success: true }
			: loaded;
	});
}

function fakeRelease(
	...results: ReadonlyArray<Result<ForceReleaseStateLockOutcome, ForceReleaseStateLockError>>
): ForceReleaseFunc {
	let callIndex = 0;
	return vi.fn<ForceReleaseFunc>(async () => {
		const next = results[callIndex];
		callIndex += 1;
		if (next === undefined) {
			throw new Error("fakeRelease invoked with no scripted result");
		}

		return next;
	});
}

function released(
	outcome: Partial<ForceReleaseStateLockOutcome>,
): Result<ForceReleaseStateLockOutcome, ForceReleaseStateLockError> {
	return {
		data: {
			displaced: undefined,
			environment: "production",
			locking: "exclusive",
			...outcome,
		},
		success: true,
	};
}

function makeDependencies(overrides: Partial<ProgDependencies> = {}): ProgDependencies {
	return {
		clack: fakeClackPort(),
		exit: vi.fn<ExitFunc>(),
		loadProject: fakeLoad(),
		...overrides,
	};
}

describe(stateUnlockCommand, () => {
	it("should say what taking a hold away does before taking it", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			forceReleaseStateLock: fakeRelease(released({})),
		});

		await stateUnlockCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(
			'Taking the hold on "production" away: a deploy still holding it keeps running, and fails its own state write rather than overwriting whatever runs next.',
		);
	});

	it("should name the holder it displaced", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({
			forceReleaseStateLock: fakeRelease(
				released({
					displaced: {
						operation: "deploy",
						owner: "ci-run-7",
						since: "2026-08-27T10:00:00.000Z",
					},
				}),
			),
		});

		await stateUnlockCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			'"production" was held by ci-run-7 for deploy since 2026-08-27T10:00:00.000Z, and is not held now',
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should report an environment nothing was holding", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			forceReleaseStateLock: fakeRelease(released({})),
		});

		await stateUnlockCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			'nothing was holding "production"',
		);
	});

	it("should report a backend that takes no hold rather than release nothing quietly", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({
			forceReleaseStateLock: fakeRelease(released({ locking: "none" })),
		});

		await stateUnlockCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			'"production" runs on a backend that takes no hold, so there is none to take away',
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should report locking the config turned off", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			forceReleaseStateLock: fakeRelease(released({ locking: "disabled" })),
		});

		await stateUnlockCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			'locking is off for "production" by config, so there is no hold to take away',
		);
	});

	it("should take every named environment's hold away and exit 1 when one refuses", async () => {
		expect.assertions(3);

		const forceReleaseStateLock = fakeRelease(
			{
				err: {
					cause: { reason: "the lock store was unreachable" },
					kind: "lockReleaseFailed",
				},
				success: false,
			},
			released({ environment: "staging" }),
		);
		const dependencies = makeDependencies({ forceReleaseStateLock });

		await stateUnlockCommand(dependencies)({ env: ["production", "staging"] });

		expect(forceReleaseStateLock).toHaveBeenCalledTimes(2);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("state unlock failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should exit 1 when the project config will not load", async () => {
		expect.assertions(2);

		const forceReleaseStateLock = fakeRelease();
		const dependencies = makeDependencies({
			forceReleaseStateLock,
			loadProject: fakeLoad({
				err: { kind: "fileNotFound", searchedFrom: "/tmp/project" },
				success: false,
			}),
		});

		await stateUnlockCommand(dependencies)({ env: "production" });

		expect(forceReleaseStateLock).not.toHaveBeenCalled();
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});
});
