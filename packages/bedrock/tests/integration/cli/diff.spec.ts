import type { Result } from "@bedrock-rbx/ocale";

import { createProg, type ProgDeps } from "#src/cli/index";
import type { Config } from "#src/core/schema";
import type { DiffPreview, PreviewDiffError } from "#src/shell/preview-diff";
import { fakeClackPort } from "#tests/helpers/clack";
import { describe, expect, it, vi } from "vitest";

type LoadConfigFunc = NonNullable<ProgDeps["loadConfig"]>;
type PreviewDiffFunc = NonNullable<ProgDeps["previewDiff"]>;
type ExitFunc = NonNullable<ProgDeps["exit"]>;

const fakeConfig: Config = {
	environments: { production: {}, staging: {} },
};

interface DiffHarness {
	readonly exitPromise: Promise<number>;
	readonly loadConfig: ReturnType<typeof vi.fn<LoadConfigFunc>>;
	readonly previewDiff: ReturnType<typeof vi.fn<PreviewDiffFunc>>;
	readonly prog: ReturnType<typeof createProg>;
}

function emptyPreview(environment: string): DiffPreview {
	return { environment, ops: [] };
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
	const loadConfig = vi.fn<LoadConfigFunc>(async () => ({ data: fakeConfig, success: true }));

	const prog = createProg({ clack: fakeClackPort(), exit, loadConfig, previewDiff });
	return { exitPromise, loadConfig, previewDiff, prog };
}

function dispatch(prog: ReturnType<typeof createProg>, argv: ReadonlyArray<string>): void {
	prog.parse(["node", "bedrock", ...argv]);
}

describe("cli diff dispatch", () => {
	it("should route 'diff --env production --config ./b.config.ts' through the action with the parsed options", async () => {
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

		expect(harness.loadConfig).toHaveBeenCalledExactlyOnceWith({
			configFile: "./bedrock.staging.config.ts",
		});
		expect(harness.previewDiff).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ config: fakeConfig, environment: "production" }),
		);
		expect(code).toBe(0);
	});

	it("should call previewDiff once per --env and exit 1 when any env fails", async () => {
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
});
