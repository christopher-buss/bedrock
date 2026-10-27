import { asResourceKey, asRobloxAssetId, type ClackPort } from "@bedrock-rbx/core";
import type { Result } from "@bedrock-rbx/ocale";

import { describe, it, vi } from "vitest";

import { createProg, type ProgDeps } from "#src/cli/index";
import { EMPTY_PLUGIN_REGISTRY } from "#src/core/plugin-registry";
import type { Config } from "#src/core/schema";
import type { DiffPreview, PreviewDiffError } from "#src/shell/preview-diff";
import { fakeClackPort } from "#tests/helpers/clack";
import { developerProductCurrent, gamePassCurrent, placeCurrent } from "#tests/helpers/resources";

type LoadProjectFunc = NonNullable<ProgDeps["loadProject"]>;
type PreviewDiffFunc = NonNullable<ProgDeps["previewDiff"]>;
type ExitFunc = NonNullable<ProgDeps["exit"]>;

const fakeConfig: Config = {
	environments: { production: {}, staging: {} },
};

interface DiffHarness {
	readonly clack: ClackPort;
	readonly exitPromise: Promise<number>;
	readonly loadProject: ReturnType<typeof vi.fn<LoadProjectFunc>>;
	readonly previewDiff: ReturnType<typeof vi.fn<PreviewDiffFunc>>;
	readonly prog: ReturnType<typeof createProg>;
}

function emptyPreview(environment: string): DiffPreview {
	return { environment, ops: [], pendingRebuild: [], redactions: [] };
}

function buildHarness(
	previewResults: ReadonlyArray<Result<DiffPreview, PreviewDiffError>>,
): DiffHarness {
	let resolveExit!: (code: number) => void;
	const exitPromise = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	const exit = vi.fn<ExitFunc>((code) => {
		resolveExit(code);
	});

	let callIndex = 0;
	const previewDiff = vi.fn<PreviewDiffFunc>(async () => {
		const next = previewResults[callIndex];
		callIndex += 1;
		if (next === undefined) {
			throw new Error("previewDiff invoked beyond scripted results");
		}

		return next;
	});
	const loadProject = vi.fn<LoadProjectFunc>(async () => {
		return { data: { config: fakeConfig, plugins: EMPTY_PLUGIN_REGISTRY }, success: true };
	});

	const clack = fakeClackPort();
	const prog = createProg({ clack, exit, loadProject, previewDiff });
	return { clack, exitPromise, loadProject, previewDiff, prog };
}

function dispatch(prog: ReturnType<typeof createProg>, argv: ReadonlyArray<string>): void {
	prog.parse(["node", "bedrock", ...argv]);
}

describe("cli diff dispatch", () => {
	it("should route 'diff --env production --config ./b.config.ts' through the action with the parsed options", async ({
		expect,
	}) => {
		expect.assertions(3);

		const harness = buildHarness([{ data: emptyPreview("production"), success: true }]);

		dispatch(harness.prog, [
			"diff",
			"--env",
			"production",
			"--config",
			"./bedrock.staging.config.ts",
		]);
		const code = await harness.exitPromise;

		expect(harness.loadProject).toHaveBeenCalledExactlyOnceWith({
			configFile: "./bedrock.staging.config.ts",
		});
		expect(harness.previewDiff).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ config: fakeConfig, environment: "production" }),
		);
		expect(code).toBe(0);
	});

	it("should call previewDiff once per --env and exit 1 when any env fails", async ({
		expect,
	}) => {
		expect.assertions(2);

		const harness = buildHarness([
			{ data: emptyPreview("production"), success: true },
			{
				err: { environment: "staging", kind: "stateNotConfigured" },
				success: false,
			},
		]);

		dispatch(harness.prog, ["diff", "--env", "production", "--env", "staging"]);
		const code = await harness.exitPromise;

		expect(harness.previewDiff).toHaveBeenCalledTimes(2);
		expect(code).toBe(1);
	});

	it("should list untrack operations with each item's name and Roblox ID", async ({ expect }) => {
		expect.assertions(5);

		const currents = [
			gamePassCurrent(),
			developerProductCurrent(),
			placeCurrent({ displayName: "Lobby" }),
			placeCurrent({ key: asResourceKey("unnamed"), placeId: asRobloxAssetId("42") }),
		];
		const harness = buildHarness([
			{
				data: {
					...emptyPreview("production"),
					ops: currents.map((current) => {
						return {
							key: current.key,
							current,
							type: "untrack",
						};
					}),
				},
				success: true,
			},
		]);
		dispatch(harness.prog, ["diff", "--env", "production"]);
		const code = await harness.exitPromise;

		expect(code).toBe(0);
		expect(harness.clack.logMessage).toHaveBeenCalledWith(
			expect.stringContaining("- gamePass:vip-pass VIP Pass (id 9876543210) untrack"),
		);
		expect(harness.clack.logMessage).toHaveBeenCalledWith(
			expect.stringContaining("- developerProduct:gem-pack Gem Pack (id 8172635495) untrack"),
		);
		expect(harness.clack.logMessage).toHaveBeenCalledWith(
			expect.stringContaining("- place:start-place Lobby (id 4711) untrack"),
		);
		expect(harness.clack.logMessage).toHaveBeenCalledWith(
			expect.stringContaining("- place:unnamed unnamed (id 42) untrack"),
		);
	});

	it("should list a retire with the current name and Roblox ID", async ({ expect }) => {
		expect.assertions(2);

		const current = gamePassCurrent();
		const harness = buildHarness([
			{
				data: {
					...emptyPreview("production"),
					ops: [{ key: current.key, current, type: "retire" }],
				},
				success: true,
			},
		]);
		dispatch(harness.prog, ["diff", "--env", "production"]);

		await expect(harness.exitPromise).resolves.toBe(0);
		expect(harness.clack.logMessage).toHaveBeenCalledWith(
			expect.stringContaining("- gamePass:vip-pass VIP Pass (id 9876543210) retire"),
		);
	});
});
