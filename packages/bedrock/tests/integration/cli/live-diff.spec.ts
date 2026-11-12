import { asRobloxAssetId, createGamePassDriver } from "@bedrock-rbx/core";
import { OpenCloudError } from "@bedrock-rbx/ocale";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import { createFakeHttpClient, validGamePassBody } from "@bedrock-rbx/ocale/testing";

import { describe, it } from "vitest";

import { diffCommand } from "#src/cli/commands/diff";
import { EMPTY_PLUGIN_REGISTRY } from "#src/core/plugin-registry";
import { previewDiffAsync } from "#src/shell/preview-diff";
import type { DiffPreview } from "#src/shell/preview-diff";
import { makeDeps } from "#tests/helpers/reconcile-command";
import { gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

function outputFor(preview: Partial<DiffPreview>) {
	return makeDeps({
		loadProject: async () => {
			return {
				data: {
					config: { environments: { production: {} } },
					plugins: EMPTY_PLUGIN_REGISTRY,
				},
				success: true,
			};
		},
		previewDiff: async () => {
			return {
				data: {
					environment: "production",
					ops: [],
					pendingRebuild: [],
					redactions: [],
					...preview,
				},
				success: true,
			};
		},
	});
}

describe("live diff output", () => {
	it("should keep a live-only update out of ordinary Drift and ask for review", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const current = gamePassCurrent();
		const deps = outputFor({
			drift: [{ key: current.key, kind: "gamePass", type: "noop" }],
			liveCheck: {
				checkedKinds: ["gamePass"],
				edits: [
					{
						key: current.key,
						fields: [{ current: 500, field: "price", live: 120 }],
						kind: "gamePass",
					},
				],
				missing: [],
				skippedKinds: [],
			},
			ops: [
				{
					key: current.key,
					changedFields: ["price"],
					current: { ...current, price: 120 },
					desired: current,
					type: "update",
				},
			],
		});
		await diffCommand(deps)({ env: ["production"] });

		expect(deps.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith('No drift for "production"');
		expect(deps.clack!.logMessage).toHaveBeenCalledWith(
			"~ gamePass:vip-pass price: 500 -> 120",
		);
		expect(deps.clack!.outro).toHaveBeenCalledExactlyOnceWith(
			"run bedrock deploy to apply pending changes",
		);
	});

	it("should report a missing tracked pass without claiming the environment is up to date", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const deps = outputFor({
			liveCheck: {
				checkedKinds: ["gamePass"],
				edits: [],
				missing: [
					{
						key: gamePassCurrent().key,
						kind: "gamePass",
						robloxId: asRobloxAssetId("9876543210"),
					},
				],
				skippedKinds: [],
			},
		});
		await diffCommand(deps)({ env: ["production"] });

		expect(deps.clack!.logMessage).toHaveBeenCalledWith(
			"! gamePass:vip-pass missing on Roblox (id 9876543210); saved Current state retained",
		);
		expect(deps.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith('No drift for "production"');
		expect(deps.clack!.outro).toHaveBeenCalledExactlyOnceWith(
			"run bedrock deploy to apply pending changes",
		);
	});

	it("should report no Out-of-band edits when checked resources match saved state", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const deps = outputFor({
			liveCheck: {
				checkedKinds: ["badge", "gamePass"],
				edits: [],
				missing: [],
				skippedKinds: [],
			},
		});
		await diffCommand(deps)({ env: ["production"] });

		expect(deps.clack!.logSuccess).toHaveBeenCalledWith(
			'No out-of-band edits for "production"',
		);
		expect(deps.clack!.logMessage).toHaveBeenCalledExactlyOnceWith(
			"Live check: checked badge, gamePass; skipped none.",
		);
		expect(deps.clack!.outro).toHaveBeenCalledExactlyOnceWith(
			"all environments are up to date",
		);
	});

	it("should visibly skip the live check when no Open Cloud credential is available", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const deps = makeDeps({
			loadProject: async () => {
				return {
					data: {
						config: { environments: { production: {} } },
						plugins: EMPTY_PLUGIN_REGISTRY,
					},
					success: true,
				};
			},
			previewDiff: async (options) => {
				return previewDiffAsync({
					...options,
					getEnv: () => {},
					statePort: fakeStateStore().port,
				});
			},
		});
		await diffCommand(deps)({ env: ["production"] });

		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(0);
		expect(deps.clack!.logSuccess).toHaveBeenCalledExactlyOnceWith('No drift for "production"');
		expect(deps.clack!.logMessage).toHaveBeenCalledExactlyOnceWith(
			"Live check: checked none; skipped badge (no Open Cloud credential), developerProduct (no Open Cloud credential), gamePass (no Open Cloud credential), place (no Open Cloud credential), universe (no Open Cloud credential). Name check skipped for badge, developerProduct, gamePass: planned creates are not checked against untracked live items.",
		);
	});

	it("should print saved config Drift separately from Out-of-band edits", async ({ expect }) => {
		expect.hasAssertions();

		const current = gamePassCurrent();
		const httpClient = createFakeHttpClient().mockResponse({
			body: {
				gamePasses: [
					validGamePassBody({
						name: current.name,
						description: current.description,
						gamePassId: 9_876_543_210,
						iconAssetId: 1_122_334_455,
						priceInformation: { defaultPriceInRobux: 120, enabledFeatures: [] },
					}),
				], // eslint-disable-next-line unicorn/no-null -- Roblox requires null on terminal list pages.
				nextPageToken: null,
			},
			status: 200,
		});
		const store = fakeStateStore({
			initial: {
				production: { environment: "production", resources: [current], version: 1 },
			},
		});
		const deps = makeDeps({
			loadProject: async () => {
				return {
					data: {
						config: {
							environments: { production: {} },
							passes: {
								"vip-pass": {
									name: current.name,
									description: "New description.",
									icon: current.icon,
									price: 500,
								},
							},
						},
						plugins: EMPTY_PLUGIN_REGISTRY,
					},
					success: true,
				};
			},
			previewDiff: async (options) => {
				return previewDiffAsync({
					...options,
					readFile: async () => new Uint8Array(),
					registry: {
						gamePass: createGamePassDriver({
							client: new GamePassesClient({
								credential: { apiKey: "fake", kind: "apiKey" },
								httpClient,
								sleep: async () => {},
							}),
							readFile: async () => new Uint8Array(),
							universeId: asRobloxAssetId("123"),
						}),
					},
					statePort: store.port,
				});
			},
		});
		await diffCommand(deps)({ env: ["production"] });

		expect(deps.clack!.logMessage).toHaveBeenNthCalledWith(1, 'Drift for "production":');
		expect(deps.clack!.logMessage).toHaveBeenNthCalledWith(
			2,
			"~ gamePass:vip-pass description updated",
		);
		expect(deps.clack!.logMessage).toHaveBeenNthCalledWith(
			3,
			'Out-of-band edits for "production":',
		);
		expect(deps.clack!.logMessage).toHaveBeenNthCalledWith(
			4,
			"~ gamePass:vip-pass price: 500 -> 120",
		);
		expect(deps.clack!.logMessage).toHaveBeenNthCalledWith(
			5,
			"Live check: checked gamePass; skipped badge (no list), developerProduct (no list), place (no metadata read), universe (no metadata read). Name check skipped for badge, developerProduct: planned creates are not checked against untracked live items.",
		);
	});

	it("should render an incomplete live read as a failed diff", async ({ expect }) => {
		expect.assertions(2);

		const deps = makeDeps({
			loadProject: async () => {
				return {
					data: {
						config: { environments: { production: {} } },
						plugins: EMPTY_PLUGIN_REGISTRY,
					},
					success: true,
				};
			},
			previewDiff: async () => {
				return {
					err: {
						cause: new OpenCloudError("read refused"),
						kind: "liveCheckFailed",
						resourceKind: "gamePass",
					},
					success: false,
				};
			},
		});
		await diffCommand(deps)({ env: ["production"] });

		expect(deps.clack!.logError).toHaveBeenCalledExactlyOnceWith(
			"live check failed for gamePass: read refused",
		);
		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
	});
});
