import type { Result } from "@bedrock-rbx/ocale";
import { fromAny } from "@total-typescript/shoehorn";

import process from "node:process";
import { describe, expect, it, onTestFinished, vi } from "vitest";

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

		// The only line before the outcome: an environment that locks says
		// nothing about locking being off.
		expect(dependencies.clack!.logMessage).toHaveBeenCalledExactlyOnceWith(
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

	it("should name a holder whose record says only who it is", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			forceReleaseStateLock: fakeRelease(released({ displaced: { owner: "ci-run-7" } })),
		});

		await stateUnlockCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			'"production" was held by ci-run-7, and is not held now',
		);
	});

	it("should close out once every named environment is unlocked", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			forceReleaseStateLock: fakeRelease(released({})),
		});

		await stateUnlockCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith("state unlock succeeded");
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

	it("should take a hold away where locking is off and say that it was", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({
			forceReleaseStateLock: fakeRelease(
				released({ displaced: { owner: "ci-run-7" }, locking: "disabled" }),
			),
		});

		await stateUnlockCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(
			'Locking is off for "production" by config, so nothing takes a hold here; a hold an earlier run left behind is still taken away.',
		);
		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			'"production" was held by ci-run-7, and is not held now',
		);
	});

	it("should take every named environment's hold away and exit 1 when one refuses", async () => {
		expect.assertions(4);

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
		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"the hold could not be taken away: the lock store was unreachable",
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("state unlock failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should name a holder the record could not name", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			forceReleaseStateLock: fakeRelease(released({ displaced: {} })),
		});

		await stateUnlockCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			'"production" was held by another run, and is not held now',
		);
	});

	it("should report an environment the config declares no state for", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({
			forceReleaseStateLock: fakeRelease({
				err: { environment: "production", kind: "stateNotConfigured" },
				success: false,
			}),
		});

		await stateUnlockCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(expect.any(String));
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should default to process.exit when no exit slot is provided", async () => {
		expect.assertions(1);

		const exitSpy = vi.spyOn(process, "exit").mockImplementation(fromAny(() => {}));
		onTestFinished(() => {
			exitSpy.mockRestore();
		});

		await stateUnlockCommand({ clack: fakeClackPort() })({});

		expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1);
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
