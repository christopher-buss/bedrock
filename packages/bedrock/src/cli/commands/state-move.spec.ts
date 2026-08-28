import type { Result } from "@bedrock-rbx/ocale";
import { fromAny } from "@total-typescript/shoehorn";

import { type } from "arktype";
import process from "node:process";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import { fakeStateBackendPlugins } from "#tests/helpers/plugins";
import { gamePassCurrent } from "#tests/helpers/resources";
import type { ConfigError } from "../../core/config-error.ts";
import { EMPTY_PLUGIN_REGISTRY, type PluginRegistry } from "../../core/plugin-registry.ts";
import type { Config } from "../../core/schema.ts";
import type { StateMoveDecision } from "../../core/state-move.ts";
import type { BedrockState, StateError } from "../../core/state.ts";
import type { MoveStateError, StateMoveOutcome } from "../../shell/move-state.ts";
import type { ProgDeps as ProgDependencies } from "../index.ts";
import { stateMoveCommand } from "./state-move.ts";

type ExitFunc = NonNullable<ProgDependencies["exit"]>;
type LoadProjectFunc = NonNullable<ProgDependencies["loadProject"]>;
type MoveStateFunc = NonNullable<ProgDependencies["moveState"]>;

const S3_PLUGINS: PluginRegistry = fakeStateBackendPlugins({
	name: "s3",
	createPort: () => ({ err: { reason: "unused in command tests" }, success: false }),
	schema: type({ "bucket": "string > 0", "region?": "string" }),
	specifier: "@bedrock-rbx/state-s3",
});

const SAMPLE_CONFIG: Config = {
	environments: { production: {}, staging: {} },
	state: { backend: "gist", gistId: "abc123" },
};

const PRODUCTION: BedrockState = { environment: "production", resources: [], version: 1 };

const REFUSAL: StateError = {
	file: "state.staging.json",
	kind: "stateAccessDenied",
	reason: "the credential was refused",
};

function fakeLoad(
	result?: Result<Config, ConfigError>,
	plugins: PluginRegistry = S3_PLUGINS,
): LoadProjectFunc {
	const loaded = result ?? { data: SAMPLE_CONFIG, success: true };
	return vi.fn<LoadProjectFunc>(async () => {
		return loaded.success ? { data: { config: loaded.data, plugins }, success: true } : loaded;
	});
}

function outcomeOf(
	decisions: ReadonlyArray<readonly [string, StateMoveDecision]>,
): StateMoveOutcome {
	return {
		decisions: new Map(decisions),
		locking: new Map(decisions.map(([environment]) => [environment, "exclusive"] as const)),
		moved: decisions.filter(([, decision]) => decision.kind === "move").map(([name]) => name),
	};
}

function fakeMove(result?: Result<StateMoveOutcome, MoveStateError>): MoveStateFunc {
	const answer =
		result ??
		({
			data: outcomeOf([
				["production", { expected: undefined, kind: "move", state: PRODUCTION }],
			]),
			success: true,
		} satisfies Result<StateMoveOutcome, MoveStateError>);
	return vi.fn<MoveStateFunc>(async () => answer);
}

function depsWith(overrides: ProgDependencies = {}): ProgDependencies {
	return {
		clack: fakeClackPort(),
		exit: vi.fn<ExitFunc>(),
		loadProject: fakeLoad(),
		moveState: fakeMove(),
		...overrides,
	};
}

async function runCommandAsync(
	deps: ProgDependencies,
	rawOptions: Readonly<Record<string, unknown>>,
): Promise<void> {
	return stateMoveCommand(deps)(rawOptions);
}

describe(stateMoveCommand, () => {
	it("should move the named environments onto the destination the flags describe", async () => {
		expect.assertions(2);

		const dependencies = depsWith();

		await runCommandAsync(dependencies, {
			"env": "production",
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.exit).toHaveBeenCalledWith(0);
		expect(dependencies.moveState).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				destination: { backend: "s3", bucket: "my-state" },
				environments: ["production"],
				force: false,
			}),
		);
	});

	it("should carry the force switch through to the move", async () => {
		expect.assertions(1);

		const dependencies = depsWith();

		await runCommandAsync(dependencies, {
			"env": "production",
			"force": true,
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.moveState).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ force: true }),
		);
	});

	it("should report each environment whose state landed", async () => {
		expect.assertions(2);

		const dependencies = depsWith();

		await runCommandAsync(dependencies, {
			"env": "production",
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			"production: 0 resources moved to s3",
		);
		expect(dependencies.clack!.logMessage).not.toHaveBeenCalled();
	});

	it("should report an environment there was nothing to move for", async () => {
		expect.assertions(1);

		const dependencies = depsWith({
			moveState: fakeMove({
				data: outcomeOf([["staging", { kind: "skip", reason: "sourceEmpty" }]]),
				success: true,
			}),
		});

		await runCommandAsync(dependencies, {
			"env": "staging",
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(
			"staging: nothing to move, the source holds no state",
		);
	});

	it("should say when an environment moved without a hold on it", async () => {
		expect.assertions(1);

		const dependencies = depsWith({
			moveState: fakeMove({
				data: {
					decisions: new Map([
						["production", { expected: undefined, kind: "move", state: PRODUCTION }],
					]),
					locking: new Map([["production", "none"]]),
					moved: ["production"],
				},
				success: true,
			}),
		});

		await runCommandAsync(dependencies, {
			"env": "production",
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(
			"production moved without a hold: the backend it was on offers no exclusion",
		);
	});

	it("should refuse a move that names no destination", async () => {
		expect.assertions(2);

		const dependencies = depsWith();

		await runCommandAsync(dependencies, { env: "production" });

		expect(dependencies.exit).toHaveBeenCalledWith(1);
		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"no destination: pass --to with one of gist, s3 and the coordinates it needs",
		);
	});

	it("should refuse a destination nothing claims", async () => {
		expect.assertions(2);

		const dependencies = depsWith();

		await runCommandAsync(dependencies, { env: "production", to: "nowhere" });

		expect(dependencies.exit).toHaveBeenCalledWith(1);
		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"no backend named 'nowhere'; the ones there are: gist, s3",
		);
	});

	it("should refuse coordinates the destination backend rejects", async () => {
		expect.assertions(2);

		const dependencies = depsWith();

		await runCommandAsync(dependencies, { env: "production", to: "s3" });

		expect(dependencies.exit).toHaveBeenCalledWith(1);
		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"--to-bucket: bucket must be a string (was missing)",
		);
	});

	it("should not move when the destination could not be assembled", async () => {
		expect.assertions(1);

		const dependencies = depsWith();

		await runCommandAsync(dependencies, { env: "production", to: "nowhere" });

		expect(dependencies.moveState).not.toHaveBeenCalled();
	});

	it("should name every environment standing in the way of a blocked move", async () => {
		expect.assertions(2);

		const dependencies = depsWith({
			moveState: fakeMove({
				err: {
					blocked: new Map([
						["staging", { held: PRODUCTION, kind: "destinationOccupied" }],
					]),
					kind: "moveBlocked",
				},
				success: false,
			}),
		});

		await runCommandAsync(dependencies, {
			"env": "staging",
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.exit).toHaveBeenCalledWith(1);
		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"staging: the destination already holds state for it; pass --force to overwrite",
		);
	});

	it("should say what had already moved when a write was refused", async () => {
		expect.assertions(2);

		const dependencies = depsWith({
			moveState: fakeMove({
				err: {
					cause: REFUSAL,
					environment: "staging",
					kind: "writeFailed",
					moved: ["production", "preview"],
				},
				success: false,
			}),
		});

		await runCommandAsync(dependencies, {
			"env": "staging",
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.clack!.logError).toHaveBeenNthCalledWith(
			1,
			"state write failed for 'staging' (state.staging.json): access denied: the credential was refused",
		);
		expect(dependencies.clack!.logError).toHaveBeenNthCalledWith(
			2,
			"production, preview is now on both sides; the source copy of each is still there",
		);
	});

	it("should report a hold the source refused", async () => {
		expect.assertions(1);

		const dependencies = depsWith({
			moveState: fakeMove({
				err: {
					cause: { reason: "another run holds it" },
					environment: "staging",
					kind: "lockAcquireFailed",
				},
				success: false,
			}),
		});

		await runCommandAsync(dependencies, {
			"env": "staging",
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"staging: could not be held for the move: another run holds it",
		);
	});

	it("should report a side whose backend could not be built", async () => {
		expect.assertions(1);

		const dependencies = depsWith({
			moveState: fakeMove({
				err: {
					cause: { environment: "staging", kind: "stateNotConfigured" },
					environment: "staging",
					kind: "sourceUnavailable",
				},
				success: false,
			}),
		});

		await runCommandAsync(dependencies, {
			"env": "staging",
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"staging: its source could not be reached: state not configured for environment 'staging'",
		);
	});

	it("should report a destination whose backend could not be built", async () => {
		expect.assertions(1);

		const dependencies = depsWith({
			moveState: fakeMove({
				err: {
					cause: {
						backend: "s3",
						hint: "pass a custom statePort via opts.statePort",
						kind: "unsupportedBackend",
					},
					kind: "destinationUnavailable",
				},
				success: false,
			}),
		});

		await runCommandAsync(dependencies, {
			"env": "staging",
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"the destination could not be reached: unsupported state backend 's3' (pass a custom statePort via opts.statePort)",
		);
	});

	it("should refuse a flag it does not recognize", async () => {
		expect.assertions(2);

		const dependencies = depsWith();

		await runCommandAsync(dependencies, { env: "production", nonsense: true });

		expect(dependencies.exit).toHaveBeenCalledWith(1);
		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"unknown flag '--nonsense'",
		);
	});

	it("should report a config that will not load", async () => {
		expect.assertions(1);

		const dependencies = depsWith({
			loadProject: fakeLoad({
				err: { kind: "fileNotFound", searchedFrom: "/project" },
				success: false,
			}),
		});

		await runCommandAsync(dependencies, {
			"env": "production",
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.exit).toHaveBeenCalledWith(1);
	});

	it("should offer only the builtin when no plugin declared a backend", async () => {
		expect.assertions(1);

		const dependencies = depsWith({
			loadProject: fakeLoad(undefined, EMPTY_PLUGIN_REGISTRY),
		});

		await runCommandAsync(dependencies, { env: "production" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"no destination: pass --to with one of gist and the coordinates it needs",
		);
	});

	it("should count a single moved resource as one", async () => {
		expect.assertions(1);

		const dependencies = depsWith({
			moveState: fakeMove({
				data: outcomeOf([
					[
						"production",
						{
							expected: undefined,
							kind: "move",
							state: {
								environment: "production",
								resources: [gamePassCurrent()],
								version: 1,
							},
						},
					],
				]),
				success: true,
			}),
		});

		await runCommandAsync(dependencies, {
			"env": "production",
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			"production: 1 resource moved to s3",
		);
	});

	it("should say which side of a blocked move could not be read", async () => {
		expect.assertions(2);

		const dependencies = depsWith({
			moveState: fakeMove({
				err: {
					blocked: new Map([
						["production", { err: REFUSAL, kind: "sourceUnreadable" }],
						["staging", { err: REFUSAL, kind: "destinationUnreadable" }],
					]),
					kind: "moveBlocked",
				},
				success: false,
			}),
		});

		await runCommandAsync(dependencies, {
			"env": "production",
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.clack!.logError).toHaveBeenNthCalledWith(
			1,
			"production: the source could not be read (state.staging.json): access denied: the credential was refused",
		);
		expect(dependencies.clack!.logError).toHaveBeenNthCalledWith(
			2,
			"staging: the destination could not be read (state.staging.json): access denied: the credential was refused",
		);
	});

	it("should say both stores are untouched when the first write was refused", async () => {
		expect.assertions(1);

		const dependencies = depsWith({
			moveState: fakeMove({
				err: {
					cause: REFUSAL,
					environment: "production",
					kind: "writeFailed",
					moved: [],
				},
				success: false,
			}),
		});

		await runCommandAsync(dependencies, {
			"env": "production",
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.clack!.logError).toHaveBeenCalledWith(
			"nothing had moved yet, so both stores are as they were",
		);
	});

	it("should default to process.exit when no exit slot is provided", async () => {
		expect.assertions(1);

		const exitSpy = vi.spyOn(process, "exit").mockImplementation(fromAny(() => {}));
		onTestFinished(() => {
			exitSpy.mockRestore();
		});

		await stateMoveCommand({ clack: fakeClackPort() })({});

		expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should frame the run under the command that opened it", async () => {
		expect.assertions(2);

		const dependencies = depsWith();

		await runCommandAsync(dependencies, {
			"env": "production",
			"to": "s3",
			"to-bucket": "my-state",
		});

		expect(dependencies.clack!.intro).toHaveBeenCalledExactlyOnceWith("bedrock state move");
		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith("state move succeeded");
	});

	it("should close a failed run under the command that opened it", async () => {
		expect.assertions(1);

		const dependencies = depsWith();

		await runCommandAsync(dependencies, { env: "production" });

		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("state move failed");
	});

	it("should offer the backends in the order they read", async () => {
		expect.assertions(1);

		const dependencies = depsWith({
			loadProject: fakeLoad(
				undefined,
				fakeStateBackendPlugins({
					name: "azure",
					createPort: () => ({ err: { reason: "unused" }, success: false }),
					schema: type({}),
					specifier: "@example/state-azure",
				}),
			),
		});

		await runCommandAsync(dependencies, { env: "production" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"no destination: pass --to with one of azure, gist and the coordinates it needs",
		);
	});
});
