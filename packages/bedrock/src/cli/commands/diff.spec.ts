import type { Result } from "@bedrock/ocale";

import { fakeClackPort } from "#tests/helpers/clack";
import process from "node:process";
import { assert, describe, expect, it, onTestFinished, vi } from "vitest";

import type { Operation } from "../../core/operations.ts";
import type { Config } from "../../core/schema.ts";
import type { DiffPreview, PreviewDiffError } from "../../shell/preview-diff.ts";
import { asResourceKey, asSha256Hex } from "../../types/ids.ts";
import type { ProgDeps } from "../index.ts";
import { diffCommand } from "./diff.ts";

type LoadConfigFunc = NonNullable<ProgDeps["loadConfig"]>;
type LoadConfigResult = Awaited<ReturnType<LoadConfigFunc>>;
type PreviewDiffFunc = NonNullable<ProgDeps["previewDiff"]>;
type ExitFunc = NonNullable<ProgDeps["exit"]>;

function makeDeps(overrides: Partial<ProgDeps> = {}): ProgDeps {
	return {
		clack: fakeClackPort(),
		exit: vi.fn<ExitFunc>(),
		...overrides,
	};
}

const sampleConfig: Config = { environments: { production: {}, staging: {} } };

const SAMPLE_HASH = asSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

function noopOp(key: string): Operation {
	return { key: asResourceKey(key), type: "noop" };
}

function createGamePassOp(key: string): Operation {
	return {
		key: asResourceKey(key),
		desired: {
			key: asResourceKey(key),
			name: "Pass",
			description: "Grants perks.",
			iconFileHash: SAMPLE_HASH,
			iconFilePath: "assets/icon.png",
			kind: "gamePass",
			price: 100,
		},
		type: "create",
	};
}

function updatePlaceOp(key: string): Operation {
	const desired = {
		key: asResourceKey(key),
		fileHash: SAMPLE_HASH,
		filePath: "places/start.rbxl",
		kind: "place" as const,
		placeId: asResourceKey("4711") as never,
	};
	return {
		key: asResourceKey(key),
		current: { ...desired, outputs: { versionNumber: 1 } },
		desired,
		type: "update",
	};
}

function preview(
	environment: string,
	ops: ReadonlyArray<Operation>,
): Result<DiffPreview, PreviewDiffError> {
	return { data: { environment, ops }, success: true };
}

function fakeLoad(result: LoadConfigResult): LoadConfigFunc {
	return vi.fn<LoadConfigFunc>(async () => result);
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

		const deps = makeDeps();

		await diffCommand(deps)(rawOptions);

		expect(deps.clack?.intro).toHaveBeenCalledExactlyOnceWith("bedrock diff");
		expect(deps.clack?.logError).toHaveBeenCalledOnce();
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("diff failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should render configLoadFailed and exit 1 when loadConfig returns Err", async () => {
		expect.assertions(3);

		const loadConfig = fakeLoad({
			err: { kind: "fileNotFound", searchedFrom: "/tmp/project" },
			success: false,
		});
		const deps = makeDeps({ loadConfig, previewDiff: vi.fn<PreviewDiffFunc>() });

		await diffCommand(deps)({ env: "production" });

		expect(deps.clack?.logError).toHaveBeenCalledOnce();
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("diff failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should forward parsed configFile to loadConfig", async () => {
		expect.assertions(1);

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([preview("production", [])]);
		const deps = makeDeps({ loadConfig, previewDiff });

		await diffCommand(deps)({ config: "./bedrock.staging.config.ts", env: "production" });

		expect(loadConfig).toHaveBeenCalledExactlyOnceWith({
			configFile: "./bedrock.staging.config.ts",
		});
	});

	it("should call loadConfig with no options when --config is absent", async () => {
		expect.assertions(1);

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([preview("production", [])]);
		const deps = makeDeps({ loadConfig, previewDiff });

		await diffCommand(deps)({ env: "production" });

		expect(loadConfig).toHaveBeenCalledExactlyOnceWith(undefined);
	});

	it("should render no-drift line and exit 0 when every op is a noop", async () => {
		expect.assertions(3);

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([preview("production", [noopOp("vip-pass")])]);
		const deps = makeDeps({ loadConfig, previewDiff });

		await diffCommand(deps)({ env: "production" });

		expect(deps.clack?.logSuccess).toHaveBeenCalledExactlyOnceWith('No drift for "production"');
		expect(deps.clack?.outro).toHaveBeenCalledExactlyOnceWith(
			"all environments are up to date",
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should render create and update ops with the kind:key prefix and suggest deploy", async () => {
		expect.assertions(5);

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			preview("production", [
				createGamePassOp("vip-pass"),
				updatePlaceOp("start-place"),
				noopOp("rookie-pass"),
			]),
		]);
		const deps = makeDeps({ loadConfig, previewDiff });

		await diffCommand(deps)({ env: "production" });

		expect(deps.clack?.logMessage).toHaveBeenNthCalledWith(
			1,
			'Pending changes for "production":',
		);
		expect(deps.clack?.logMessage).toHaveBeenNthCalledWith(2, "+ gamePass:vip-pass");
		expect(deps.clack?.logMessage).toHaveBeenNthCalledWith(3, "~ place:start-place");
		expect(deps.clack?.outro).toHaveBeenCalledExactlyOnceWith(
			"run bedrock deploy to apply pending changes",
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should render the previewDiff Err and exit 1 when the call returns unknownEnvironment", async () => {
		expect.assertions(3);

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
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
		const deps = makeDeps({ loadConfig, previewDiff });

		await diffCommand(deps)({ env: "ghost" });

		expect(deps.clack?.logError).toHaveBeenCalledOnce();
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("diff failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should call previewDiff once per --env and outro up-to-date when no env has drift", async () => {
		expect.assertions(3);

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([preview("production", []), preview("staging", [])]);
		const deps = makeDeps({ loadConfig, previewDiff });

		await diffCommand(deps)({ env: ["production", "staging"] });

		expect(previewDiff).toHaveBeenCalledTimes(2);
		expect(deps.clack?.outro).toHaveBeenCalledExactlyOnceWith(
			"all environments are up to date",
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should outro suggesting deploy when at least one env has drift across multiple envs", async () => {
		expect.assertions(2);

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			preview("production", [noopOp("vip-pass")]),
			preview("staging", [createGamePassOp("beta-pass")]),
		]);
		const deps = makeDeps({ loadConfig, previewDiff });

		await diffCommand(deps)({ env: ["production", "staging"] });

		expect(deps.clack?.outro).toHaveBeenCalledExactlyOnceWith(
			"run bedrock deploy to apply pending changes",
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should call previewDiff for every env even when one fails, then exit 1", async () => {
		expect.assertions(4);

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([
			{
				err: { environment: "production", kind: "stateNotConfigured" },
				success: false,
			},
			preview("staging", [noopOp("vip-pass")]),
		]);
		const deps = makeDeps({ loadConfig, previewDiff });

		await diffCommand(deps)({ env: ["production", "staging"] });

		expect(previewDiff).toHaveBeenCalledTimes(2);
		expect(deps.clack?.logSuccess).toHaveBeenCalledExactlyOnceWith('No drift for "staging"');
		expect(deps.clack?.cancel).toHaveBeenCalledExactlyOnceWith("diff failed");
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("should thread --api-key and --github-token through getEnv into previewDiff", async () => {
		expect.assertions(4);

		vi.stubEnv("UNRELATED_VAR", "from-process-unrelated");

		try {
			const loadConfig = fakeLoad({ data: sampleConfig, success: true });
			const previewDiff = fakePreview([preview("production", [])]);
			const deps = makeDeps({ loadConfig, previewDiff });

			await diffCommand(deps)({
				"api-key": "ROBLOX_OVERRIDE",
				"env": "production",
				"github-token": "GH_OVERRIDE",
			});

			expect(previewDiff).toHaveBeenCalledOnce();

			const firstCall = vi.mocked(previewDiff).mock.calls[0];
			assert(firstCall !== undefined);

			const [call] = firstCall;

			expect(call.getEnv?.("ROBLOX_API_KEY")).toBe("ROBLOX_OVERRIDE");
			expect(call.getEnv?.("GITHUB_TOKEN")).toBe("GH_OVERRIDE");
			expect(call.getEnv?.("UNRELATED_VAR")).toBe("from-process-unrelated");
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("should overlay each credential flag only on its named slot, not the other", async () => {
		expect.assertions(3);

		vi.stubEnv("ROBLOX_API_KEY", "from-process-roblox");
		vi.stubEnv("GITHUB_TOKEN", "from-process-github");

		try {
			const loadConfig = fakeLoad({ data: sampleConfig, success: true });
			const previewDiff = fakePreview([preview("production", [])]);
			const deps = makeDeps({ loadConfig, previewDiff });

			await diffCommand(deps)({ "api-key": "FLAG_ROBLOX", "env": "production" });

			const firstCall = vi.mocked(previewDiff).mock.calls[0];
			assert(firstCall !== undefined);

			const [call] = firstCall;

			expect(call.getEnv?.("ROBLOX_API_KEY")).toBe("FLAG_ROBLOX");
			expect(call.getEnv?.("GITHUB_TOKEN")).toBe("from-process-github");
			expect(call.getEnv?.("UNRELATED_VAR")).toBeUndefined();
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("should fall back to process.env when neither --api-key nor --github-token is supplied", async () => {
		expect.assertions(2);

		vi.stubEnv("ROBLOX_API_KEY", "process-roblox");
		vi.stubEnv("GITHUB_TOKEN", "process-github");

		try {
			const loadConfig = fakeLoad({ data: sampleConfig, success: true });
			const previewDiff = fakePreview([preview("production", [])]);
			const deps = makeDeps({ loadConfig, previewDiff });

			await diffCommand(deps)({ env: "production" });

			const firstCall = vi.mocked(previewDiff).mock.calls[0];
			assert(firstCall !== undefined);

			const [call] = firstCall;

			expect(call.getEnv?.("ROBLOX_API_KEY")).toBe("process-roblox");
			expect(call.getEnv?.("GITHUB_TOKEN")).toBe("process-github");
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("should preview with BEDROCK_ENVIRONMENT when --env is omitted", async () => {
		expect.assertions(2);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_ENVIRONMENT", "production");

		const loadConfig = fakeLoad({ data: sampleConfig, success: true });
		const previewDiff = fakePreview([preview("production", [])]);
		const deps = makeDeps({ loadConfig, previewDiff });

		await diffCommand(deps)({});

		expect(previewDiff).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ config: sampleConfig, environment: "production" }),
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it("should default to process.exit when no exit slot is provided", async () => {
		expect.assertions(1);

		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => {}) as typeof process.exit);

		try {
			await diffCommand({ clack: fakeClackPort() })({});

			expect(exitSpy).toHaveBeenCalledExactlyOnceWith(1);
		} finally {
			exitSpy.mockRestore();
		}
	});
});
