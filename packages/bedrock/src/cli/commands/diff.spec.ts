import type { Result } from "@bedrock-rbx/ocale";
import { fromAny } from "@total-typescript/shoehorn";

import process from "node:process";
import { assert, describe, expect, it, onTestFinished, vi } from "vitest";

import { fakeClackPort } from "#tests/helpers/clack";
import type { ConfigError } from "../../core/config-error.ts";
import type { Operation } from "../../core/operations.ts";
import { EMPTY_PLUGIN_REGISTRY, type PluginRegistry } from "../../core/plugin-registry.ts";
import type { RedactionAnnotation } from "../../core/redact-resources.ts";
import type { Config } from "../../core/schema.ts";
import type { StateLockError, StateLockHolding } from "../../ports/state-lock-port.ts";
import type { DiffPreview, PreviewDiffError } from "../../shell/preview-diff.ts";
import { asResourceKey, asRobloxAssetId, asSha256Hex } from "../../types/ids.ts";
import type { ProgDeps as ProgDependencies } from "../index.ts";
import { diffCommand } from "./diff.ts";

type LoadProjectFunc = NonNullable<ProgDependencies["loadProject"]>;
type PreviewDiffFunc = NonNullable<ProgDependencies["previewDiff"]>;
type ExitFunc = NonNullable<ProgDependencies["exit"]>;

function makeDependencies(overrides: Partial<ProgDependencies> = {}): ProgDependencies {
	return {
		clack: fakeClackPort(),
		exit: vi.fn<ExitFunc>(),
		...overrides,
	};
}

const sampleConfig: Config = { environments: { production: {}, staging: {} } };

const SAMPLE_HASH = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

function noopOp(key: string): Operation {
	return { key: asResourceKey(key), kind: "gamePass", type: "noop" };
}

function createGamePassOp(key: string): Operation {
	return {
		key: asResourceKey(key),
		desired: {
			key: asResourceKey(key),
			name: "Pass",
			description: "Grants perks.",
			icon: { "en-us": "assets/icon.png" },
			iconFileHashes: { "en-us": SAMPLE_HASH },
			kind: "gamePass",
			price: 100,
		},
		type: "create",
	};
}

function updatePlaceOp(key: string): Operation {
	const desired = {
		key: asResourceKey(key),
		description: undefined,
		displayName: undefined,
		fileHash: SAMPLE_HASH,
		filePath: "places/start.rbxl",
		kind: "place" as const,
		placeId: asRobloxAssetId("4711"),
		serverSize: undefined,
	};
	return {
		key: asResourceKey(key),
		changedFields: ["fileHash"],
		current: { ...desired, outputs: { versionNumber: 1 } },
		desired,
		type: "update",
	};
}

function multiFieldUpdatePlaceOp(key: string): Operation {
	const desired = {
		key: asResourceKey(key),
		description: "New body",
		displayName: "New name",
		fileHash: SAMPLE_HASH,
		filePath: "places/start.rbxl",
		kind: "place" as const,
		placeId: asRobloxAssetId("4711"),
		serverSize: undefined,
	};
	const current = {
		...desired,
		description: "Old body",
		displayName: "Old name",
		outputs: { versionNumber: 1 },
	};
	return {
		key: asResourceKey(key),
		changedFields: ["displayName", "description"],
		current,
		desired,
		type: "update",
	};
}

function preview(input: {
	concurrentHold?: StateLockHolding;
	environment: string;
	holdUnknown?: StateLockError;
	ops: ReadonlyArray<Operation>;
	pendingRebuild?: ReadonlyArray<string>;
	redactions?: ReadonlyArray<RedactionAnnotation>;
}): Result<DiffPreview, PreviewDiffError> {
	return {
		data: {
			concurrentHold: input.concurrentHold,
			environment: input.environment,
			holdUnknown: input.holdUnknown,
			ops: input.ops,
			pendingRebuild: (input.pendingRebuild ?? []).map((key) => asResourceKey(key)),
			redactions: input.redactions ?? [],
		},
		success: true,
	};
}

/**
 * A project loader answering with one canned config, or with the load
 * failure a test scripted. Call sites state the config, so what the
 * plugins declared stays out of the way until a test cares.
 *
 * @param result - The config to load, or the failure to report.
 * @param plugins - What the load should report the plugins declared.
 * @returns The loader to inject.
 */
function fakeLoad(
	result: Result<Config, ConfigError>,
	plugins: PluginRegistry = EMPTY_PLUGIN_REGISTRY,
): LoadProjectFunc {
	return vi.fn<LoadProjectFunc>(async () => {
		return result.success ? { data: { config: result.data, plugins }, success: true } : result;
	});
}

function fakePreview(
	mapping: ReadonlyArray<Result<DiffPreview, PreviewDiffError>>,
): PreviewDiffFunc {
	let callIndex = 0;
	return vi.fn<PreviewDiffFunc>(async () => {
		const next = mapping[callIndex];
		callIndex += 1;
		if (next === undefined) {
			throw new Error("fakePreview invoked with no scripted result");
		}

		return next;
	});
}

describe(diffCommand, () => {
	it("should report that the preview may be stale while a deploy holds the environment", async () => {
		expect.assertions(2);

		const dependencies = makeDependencies({
			loadProject: fakeLoad({ data: sampleConfig, success: true }),
			previewDiff: fakePreview([
				preview({
					concurrentHold: {
						operation: "deploy",
						owner: "ci-run-7",
						since: "2026-08-27T10:00:00.000Z",
					},
					environment: "production",
					ops: [noopOp("vip-pass")],
				}),
			]),
		});

		await diffCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(
			'"production" is held by ci-run-7 for deploy since 2026-08-27T10:00:00.000Z, so this diff may already be out of date',
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should report a hold whose record names no holder", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			loadProject: fakeLoad({ data: sampleConfig, success: true }),
			previewDiff: fakePreview([
				preview({
					concurrentHold: {},
					environment: "production",
					ops: [noopOp("vip-pass")],
				}),
			]),
		});

		await diffCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(
			'"production" is held by another run, so this diff may already be out of date',
		);
	});

	it("should name a holder whose record says only who it is", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			loadProject: fakeLoad({ data: sampleConfig, success: true }),
			previewDiff: fakePreview([
				preview({
					concurrentHold: { owner: "ci-run-7" },
					environment: "production",
					ops: [noopOp("vip-pass")],
				}),
			]),
		});

		await diffCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(
			'"production" is held by ci-run-7, so this diff may already be out of date',
		);
	});

	it("should report a lock store that could not say who holds the environment", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			loadProject: fakeLoad({ data: sampleConfig, success: true }),
			previewDiff: fakePreview([
				preview({
					environment: "production",
					holdUnknown: { reason: "the lock store was unreachable" },
					ops: [noopOp("vip-pass")],
				}),
			]),
		});

		await diffCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(
			'who holds "production" could not be read (the lock store was unreachable), so this diff may already be out of date',
		);
	});

	it("should say nothing about a hold when nothing holds the environment", async () => {
		expect.assertions(1);

		const dependencies = makeDependencies({
			loadProject: fakeLoad({ data: sampleConfig, success: true }),
			previewDiff: fakePreview([preview({ environment: "production", ops: [noopOp("x")] })]),
		});

		await diffCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logMessage).not.toHaveBeenCalled();
	});

	it.for<{ label: string; rawOptions: Record<string, unknown> }>([
		{ label: "missingRequired", rawOptions: {} },
		{ label: "unknownFlag", rawOptions: { env: "production", verbose: true } },
		{ label: "invalidValue", rawOptions: { env: false } },
	])("should surface a $label parse error and exit with code 1", async ({ rawOptions }) => {
		expect.assertions(4);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_ENVIRONMENT", undefined);

		const dependencies = makeDependencies();

		await diffCommand(dependencies)(rawOptions);

		expect(dependencies.clack!.intro).toHaveBeenCalledExactlyOnceWith("bedrock diff");
		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(expect.any(String));
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("diff failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render configLoadFailed and exit 1 when loadProject returns Err", async () => {
		expect.assertions(3);

		const loadProject = fakeLoad({
			err: { kind: "fileNotFound", searchedFrom: "/tmp/project" },
			success: false,
		});
		const dependencies = makeDependencies({
			loadProject,
			previewDiff: vi.fn<PreviewDiffFunc>(),
		});

		await diffCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(expect.any(String));
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("diff failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should forward parsed configFile to loadProject", async () => {
		expect.assertions(1);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([preview({ environment: "production", ops: [] })]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({
			config: "./bedrock.staging.config.ts",
			env: "production",
		});

		expect(loadProject).toHaveBeenCalledExactlyOnceWith({
			configFile: "./bedrock.staging.config.ts",
		});
	});

	it("should call loadProject with no options when --config is absent", async () => {
		expect.assertions(1);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([preview({ environment: "production", ops: [] })]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: "production" });

		expect(loadProject).toHaveBeenCalledExactlyOnceWith(undefined);
	});

	it("should render no-drift line and exit 0 when every op is a noop without any redacted section", async () => {
		expect.assertions(4);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			preview({ environment: "production", ops: [noopOp("vip-pass")] }),
		]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			'No drift for "production"',
		);
		expect(dependencies.clack!.logMessage).not.toHaveBeenCalled();
		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith(
			"all environments are up to date",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should report places minted but unpublished as drift when a pending-rebuild marker persists", async () => {
		expect.assertions(4);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			preview({
				environment: "production",
				ops: [noopOp("vip-pass")],
				pendingRebuild: ["arena", "lobby"],
			}),
		]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logSuccess).not.toHaveBeenCalled();
		expect(dependencies.clack!.logMessage).toHaveBeenCalledExactlyOnceWith(
			'2 place(s) minted but unpublished in "production": arena, lobby',
		);
		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith(
			"run bedrock deploy to apply pending changes",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should render the pending-publish line after the drift ops when both are present", async () => {
		expect.assertions(2);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			preview({
				environment: "production",
				ops: [createGamePassOp("vip-pass")],
				pendingRebuild: ["start-place"],
			}),
		]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: "production" });

		expect(vi.mocked(dependencies.clack!.logMessage).mock.calls).toMatchInlineSnapshot(`
		  [
		    [
		      "Pending changes for "production":",
		    ],
		    [
		      "+ gamePass:vip-pass",
		    ],
		    [
		      "1 place(s) minted but unpublished in "production": start-place",
		    ],
		  ]
		`);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should annotate redacted noops after the no-drift line and keep the up-to-date outro", async () => {
		expect.assertions(2);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			preview({
				environment: "production",
				ops: [noopOp("vip-pass"), noopOp("elite-pass")],
				redactions: [
					{
						key: asResourceKey("vip-pass"),
						hasRealValueEdits: false,
						kind: "gamePass",
					},
					{
						key: asResourceKey("elite-pass"),
						hasRealValueEdits: true,
						kind: "gamePass",
					},
				],
			}),
		]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: "production" });

		expect(vi.mocked(dependencies.clack!.logMessage).mock.calls).toMatchInlineSnapshot(`
		  [
		    [
		      "Redacted in "production":",
		    ],
		    [
		      "- gamePass:vip-pass (redacted)",
		    ],
		    [
		      "- gamePass:elite-pass (redacted, real values not pushed)",
		    ],
		  ]
		`);
		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith(
			"all environments are up to date",
		);
	});

	it("should render create and update ops with the kind:key prefix and suggest deploy", async () => {
		expect.assertions(5);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			preview({
				environment: "production",
				ops: [
					createGamePassOp("vip-pass"),
					updatePlaceOp("start-place"),
					noopOp("rookie-pass"),
				],
			}),
		]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logMessage).toHaveBeenNthCalledWith(
			1,
			'Pending changes for "production":',
		);
		expect(dependencies.clack!.logMessage).toHaveBeenNthCalledWith(2, "+ gamePass:vip-pass");
		expect(dependencies.clack!.logMessage).toHaveBeenNthCalledWith(
			3,
			"~ place:start-place fileHash updated",
		);
		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith(
			"run bedrock deploy to apply pending changes",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should join multiple changed fields with ' + ' for an update op", async () => {
		expect.assertions(1);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			preview({
				environment: "production",
				ops: [multiFieldUpdatePlaceOp("start-place")],
			}),
		]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: "production" });

		expect(dependencies.clack!.logMessage).toHaveBeenNthCalledWith(
			2,
			"~ place:start-place displayName + description updated",
		);
	});

	it("should render the redacted section after the drift section and skip redactions whose op is a create or update", async () => {
		expect.assertions(2);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			preview({
				environment: "production",
				ops: [
					createGamePassOp("fresh-pass"),
					noopOp("vip-pass"),
					createGamePassOp("secret-pass"),
				],
				redactions: [
					{
						key: asResourceKey("vip-pass"),
						hasRealValueEdits: true,
						kind: "gamePass",
					},
					{
						key: asResourceKey("secret-pass"),
						hasRealValueEdits: true,
						kind: "gamePass",
					},
				],
			}),
		]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: "production" });

		expect(vi.mocked(dependencies.clack!.logMessage).mock.calls).toMatchInlineSnapshot(`
		  [
		    [
		      "Pending changes for "production":",
		    ],
		    [
		      "+ gamePass:fresh-pass",
		    ],
		    [
		      "+ gamePass:secret-pass",
		    ],
		    [
		      "Redacted in "production":",
		    ],
		    [
		      "- gamePass:vip-pass (redacted, real values not pushed)",
		    ],
		  ]
		`);
		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith(
			"run bedrock deploy to apply pending changes",
		);
	});

	it("should skip the redacted annotation when the redaction's own kind+key has a drift op even if another kind shares the key", async () => {
		expect.assertions(2);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			preview({
				environment: "production",
				ops: [createGamePassOp("vip-pass"), noopOp("vip-pass")],
				redactions: [
					{
						key: asResourceKey("vip-pass"),
						hasRealValueEdits: true,
						kind: "gamePass",
					},
				],
			}),
		]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: "production" });

		expect(vi.mocked(dependencies.clack!.logMessage).mock.calls).toMatchInlineSnapshot(`
		  [
		    [
		      "Pending changes for "production":",
		    ],
		    [
		      "+ gamePass:vip-pass",
		    ],
		  ]
		`);
		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith(
			"run bedrock deploy to apply pending changes",
		);
	});

	it("should render the previewDiff Err and exit 1 when the call returns unknownEnvironment", async () => {
		expect.assertions(3);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			{
				err: {
					declared: ["production"],
					environment: "ghost",
					kind: "unknownEnvironment",
				},
				success: false,
			},
		]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: "ghost" });

		expect(dependencies.clack!.logError).toHaveBeenCalledExactlyOnceWith(expect.any(String));
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("diff failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should call previewDiff once per --env and outro up-to-date when no env has drift", async () => {
		expect.assertions(3);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			preview({ environment: "production", ops: [] }),
			preview({ environment: "staging", ops: [] }),
		]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: ["production", "staging"] });

		expect(previewDiff).toHaveBeenCalledTimes(2);
		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith(
			"all environments are up to date",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should outro suggesting deploy when at least one env has drift across multiple envs", async () => {
		expect.assertions(2);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			preview({ environment: "production", ops: [noopOp("vip-pass")] }),
			preview({ environment: "staging", ops: [createGamePassOp("beta-pass")] }),
		]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: ["production", "staging"] });

		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith(
			"run bedrock deploy to apply pending changes",
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should keep the up-to-date outro when only redacted noops appear across envs even though one env declares them", async () => {
		expect.assertions(2);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			preview({ environment: "production", ops: [noopOp("vip-pass")] }),
			preview({
				environment: "staging",
				ops: [noopOp("vip-pass")],
				redactions: [
					{
						key: asResourceKey("vip-pass"),
						hasRealValueEdits: true,
						kind: "gamePass",
					},
				],
			}),
		]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: ["production", "staging"] });

		expect(dependencies.clack!.logMessage).toHaveBeenCalledWith(
			"- gamePass:vip-pass (redacted, real values not pushed)",
		);
		expect(dependencies.clack!.outro).toHaveBeenCalledExactlyOnceWith(
			"all environments are up to date",
		);
	});

	it("should call previewDiff for every env even when one fails, then exit 1", async () => {
		expect.assertions(4);

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			{
				err: { environment: "production", kind: "stateNotConfigured" },
				success: false,
			},
			preview({ environment: "staging", ops: [noopOp("vip-pass")] }),
		]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: ["production", "staging"] });

		expect(previewDiff).toHaveBeenCalledTimes(2);
		expect(dependencies.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith(
			'No drift for "staging"',
		);
		expect(dependencies.clack!.cancel).toHaveBeenCalledExactlyOnceWith("diff failed");
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should thread --api-key and --github-token through getEnv into previewDiff", async () => {
		expect.assertions(4);

		vi.stubEnv("UNRELATED_VAR", "from-process-unrelated");
		onTestFinished(() => {
			vi.unstubAllEnvs();
		});

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([preview({ environment: "production", ops: [] })]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({
			"api-key": "BEDROCK_OVERRIDE",
			"env": "production",
			"github-token": "GH_OVERRIDE",
		});

		expect(previewDiff).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ config: sampleConfig, environment: "production" }),
		);

		const firstCall = vi.mocked(previewDiff).mock.calls[0];
		assert(firstCall !== undefined);

		const [call] = firstCall;

		expect(call.getEnv!("BEDROCK_API_KEY")).toBe("BEDROCK_OVERRIDE");
		expect(call.getEnv!("BEDROCK_GITHUB_TOKEN")).toBe("GH_OVERRIDE");
		expect(call.getEnv!("UNRELATED_VAR")).toBe("from-process-unrelated");
	});

	it("should overlay each credential flag only on its named slot, not the other", async () => {
		expect.assertions(3);

		vi.stubEnv("BEDROCK_API_KEY", "from-process-bedrock");
		vi.stubEnv("BEDROCK_GITHUB_TOKEN", "from-process-github");
		onTestFinished(() => {
			vi.unstubAllEnvs();
		});

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([preview({ environment: "production", ops: [] })]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ "api-key": "FLAG_BEDROCK", "env": "production" });

		const firstCall = vi.mocked(previewDiff).mock.calls[0];
		assert(firstCall !== undefined);

		const [call] = firstCall;

		expect(call.getEnv!("BEDROCK_API_KEY")).toBe("FLAG_BEDROCK");
		expect(call.getEnv!("BEDROCK_GITHUB_TOKEN")).toBe("from-process-github");
		expect(call.getEnv!("UNRELATED_VAR")).toBeUndefined();
	});

	it("should fall back to process.env when neither --api-key nor --github-token is supplied", async () => {
		expect.assertions(2);

		vi.stubEnv("BEDROCK_API_KEY", "process-bedrock");
		vi.stubEnv("BEDROCK_GITHUB_TOKEN", "process-github");
		onTestFinished(() => {
			vi.unstubAllEnvs();
		});

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([preview({ environment: "production", ops: [] })]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({ env: "production" });

		const firstCall = vi.mocked(previewDiff).mock.calls[0];
		assert(firstCall !== undefined);

		const [call] = firstCall;

		expect(call.getEnv!("BEDROCK_API_KEY")).toBe("process-bedrock");
		expect(call.getEnv!("BEDROCK_GITHUB_TOKEN")).toBe("process-github");
	});

	it("should preview with BEDROCK_ENVIRONMENT when --env is omitted", async () => {
		expect.assertions(2);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_ENVIRONMENT", "production");

		const loadProject = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([preview({ environment: "production", ops: [] })]);
		const dependencies = makeDependencies({ loadProject, previewDiff });

		await diffCommand(dependencies)({});

		expect(previewDiff).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ config: sampleConfig, environment: "production" }),
		);
		expect(dependencies.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should default to process.exit when no exit slot is provided", async () => {
		expect.assertions(1);

		const exitSpy = vi.spyOn(process, "exit").mockImplementation(fromAny(() => {}));
		onTestFinished(() => {
			exitSpy.mockRestore();
		});

		await diffCommand({ clack: fakeClackPort() })({});

		expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1);
	});
});
