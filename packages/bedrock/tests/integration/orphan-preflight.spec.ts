import {
	asResourceKey,
	asRobloxAssetId,
	createDeveloperProductDriver,
	createGamePassDriver,
	createPlaceDriver,
	createUniverseDriver,
	deploy,
	diff,
	type DriverRegistry,
	type ProgressEvent,
	provision,
	publish,
} from "@bedrock-rbx/core";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validDeveloperProductBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it } from "vitest";

import { deployCommand } from "#src/cli/commands/deploy";
import { diffCommand } from "#src/cli/commands/diff";
import { provisionCommand } from "#src/cli/commands/provision";
import { publishCommand } from "#src/cli/commands/publish";
import { EMPTY_PLUGIN_REGISTRY } from "#src/core/plugin-registry";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { makeDeps } from "#tests/helpers/reconcile-command";
import {
	developerProductCurrent,
	gamePassCurrent,
	gamePassDesired,
	placeCurrent,
	universeCurrent,
} from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";

async function noFilesAsync(): Promise<Uint8Array> {
	throw new Error("Preflight must not read withheld artifacts");
}

function registry(httpClient: FakeHttpClient): DriverRegistry {
	const options = {
		credential: { apiKey: "fake", kind: "apiKey" } as const,
		httpClient,
		sleep: async () => {},
	};
	const dependencies = { readFile: noFilesAsync, universeId: asRobloxAssetId("123") };
	return {
		developerProduct: createDeveloperProductDriver({
			...dependencies,
			client: new DeveloperProductsClient(options),
		}),
		gamePass: createGamePassDriver({ ...dependencies, client: new GamePassesClient(options) }),
		place: createPlaceDriver({ ...dependencies, client: new PlacesClient(options) }),
		universe: createUniverseDriver({
			places: new PlacesClient(options),
			universes: new UniversesClient(options),
		}),
	};
}

describe("orphan preflight", () => {
	it.for([
		{ current: gamePassCurrent(), refusal: "orphanRejected" },
		{ current: universeCurrent(), refusal: "retirementRejected" },
	])(
		"should retain $refusal without writes when cross-environment reporting cannot read state",
		async ({ current, refusal }, { expect }) => {
			expect.hasAssertions();

			const initial = {
				environment: "production",
				resources: [current, developerProductCurrent()],
				version: 1,
			} as const;
			const trace: Array<string> = [];
			const store = fakeStateStore({
				initial: { production: initial },
				refuseRead: {
					staging: { file: "staging.json", kind: "stateError", reason: "unavailable" },
				},
				trace,
			});
			const http = createFakeHttpClient();
			const events: Array<ProgressEvent> = [];
			const result = await deploy({
				config: {
					environments: { production: {}, staging: {} },
					products: { "gem-pack": { retired: "untrack" } },
				},
				environment: "production",
				progress: {
					emit: (event) => {
						events.push(event);
					},
				},
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			});

			expect(result).toMatchObject({
				err: { cause: { kind: refusal }, kind: "buildDesiredFailed" },
				success: false,
			});
			expect(events).toContainEqual({
				environment: "production",
				kind: "declarationReport",
				report: {
					key: "gem-pack",
					activeEnvironments: ["production"],
					declaration: "retired",
					oldKey: "gem-pack",
					resourceKind: "developerProduct",
					unknownEnvironments: ["staging"],
				},
			});
			expect({ requests: http.requests, trace, writes: store.writes }).toStrictEqual({
				requests: [],
				trace: ["read:production", "read:staging"],
				writes: [],
			});
			expect(store.states.get("production")).toBe(initial);
		},
	);

	it.for([deploy, provision, publish, previewDiffAsync])(
		"should refuse an absent universe before sibling operations through %s",
		async (command, { expect }) => {
			expect.hasAssertions();

			const initial = {
				environment: "production",
				resources: [gamePassCurrent(), universeCurrent()],
				version: 1,
			} as const;
			const store = fakeStateStore({ initial: { production: initial } });
			const http = createFakeHttpClient().mockResponse({
				body: validDeveloperProductBody(),
				status: 200,
			});
			const result = await command({
				config: {
					environments: { production: {} },
					passes: { "vip-pass": { retired: "untrack" } },
					products: { fresh: { name: "Fresh", description: "New" } },
				},
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			});

			expect(result).toMatchObject({
				err: {
					cause: {
						key: "main",
						kind: "retirementRejected",
						message: "Universe removal is not available at this time.",
					},
					kind: "buildDesiredFailed",
				},
				success: false,
			});
			expect(http.requests).toBeEmpty();
			expect(store.writes).toBeEmpty();
			expect(store.states.get("production")).toBe(initial);
		},
	);

	it("should refuse universe absence through pure diff even when another kind declares its key", ({
		expect,
	}) => {
		expect.assertions(1);
		expect(() => {
			return diff([gamePassDesired({ key: asResourceKey("main") })], [universeCurrent()]);
		}).toThrow(new Error("Universe removal is not available at this time."));
	});

	it("should retain the universe removal message before a root-place retirement refusal", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const place = placeCurrent();
		const store = fakeStateStore({
			initial: {
				production: {
					environment: "production",
					resources: [
						universeCurrent({ outputs: { rootPlaceId: place.placeId } }),
						place,
					],
					version: 1,
				},
			},
		});
		const http = createFakeHttpClient();
		const result = await provision({
			config: {
				environments: { production: {} },
				places: { "start-place": { retired: true } },
			},
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(http),
			statePort: store.port,
		});

		expect(result).toMatchObject({
			err: {
				cause: {
					kind: "retirementRejected",
					message: "Universe removal is not available at this time.",
				},
				kind: "buildDesiredFailed",
			},
			success: false,
		});
		expect({ requests: http.requests, writes: store.writes }).toStrictEqual({
			requests: [],
			writes: [],
		});
	});

	it("should print the unavailable universe removal message and fail diff", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const config = { environments: { production: {} } };
		const store = fakeStateStore({
			initial: {
				production: {
					environment: "production",
					resources: [universeCurrent()],
					version: 1,
				},
			},
		});
		const deps = makeDeps({
			loadProject: async () => {
				return { data: { config, plugins: EMPTY_PLUGIN_REGISTRY }, success: true };
			},
			previewDiff: async (input) => {
				return previewDiffAsync({
					...input,
					readFile: noFilesAsync,
					statePort: store.port,
				});
			},
		});
		await diffCommand(deps)({ env: "production" });

		expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
		expect(deps.clack!.logError).toHaveBeenCalledWith(
			"build desired state failed for 'main': Universe removal is not available at this time.",
		);
		expect(store.writes).toBeEmpty();
	});

	it.for([
		{
			command: provision,
			display: { "place:arena": { displayName: "Real arena" } },
			identities: ["developerProduct:renamed", "place:arena"],
			readFile: noFilesAsync,
			reads: [],
		},
		{
			command: publish,
			display: undefined,
			identities: ["gamePass:vip-pass", "developerProduct:renamed", "place:arena"],
			readFile: async () => new Uint8Array([1, 2, 3]),
			reads: ["withheld.rbxl"],
		},
	])(
		"should resolve markers and implicit adoption against full declarations before filtering through $command",
		async (stage, { expect }) => {
			expect.hasAssertions();

			const place = placeCurrent({ filePath: "withheld.rbxl" });
			const product = developerProductCurrent();
			const pass = gamePassCurrent();
			const store = fakeStateStore({
				initial: {
					production: {
						environment: "production",
						pendingRebuild: new Set([place.key]),
						realDisplay: { "place:start-place": { displayName: "Real arena" } },
						resources: [pass, product, place],
						version: 1,
					},
				},
			});
			const http = createFakeHttpClient();
			const reads: Array<string> = [];
			const result = await stage.command({
				config: {
					environments: { production: { places: { arena: { placeId: place.placeId } } } },
					passes: { "vip-pass": { retired: "untrack" } },
					places: { arena: { filePath: "withheld.rbxl" } },
					products: {
						renamed: {
							name: product.name,
							description: product.description,
							movedFrom: "gem-pack",
						},
					},
				},
				environment: "production",
				async readFile(path) {
					reads.push(path);
					return stage.readFile();
				},
				registry: registry(http),
				statePort: store.port,
			});
			assert(result.success);

			expect(result.data.resources.map(({ key, kind }) => `${kind}:${key}`)).toStrictEqual(
				stage.identities,
			);
			expect(result.data.realDisplay).toStrictEqual(stage.display);
			expect(
				result.data.resources.find((entry) => entry.kind === "developerProduct"),
			).toMatchObject({ outputs: product.outputs });
			expect({ reads, requests: http.requests }).toStrictEqual({
				reads: stage.reads,
				requests: [],
			});
			expect(store.writes).toHaveLength(1);
		},
	);

	it("should still refuse an orphan beside a declared buildable place without reading its artifact", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient();
		const store = fakeStateStore({
			initial: {
				production: {
					environment: "production",
					resources: [placeCurrent(), gamePassCurrent()],
					version: 1,
				},
			},
		});
		const result = await provision({
			config: {
				environments: { production: { places: { "start-place": { placeId: "4711" } } } },
				places: { "start-place": { filePath: "withheld.rbxl" } },
			},
			environment: "production",
			readFile: noFilesAsync,
			registry: registry(http),
			statePort: store.port,
		});

		expect(result).toMatchObject({
			err: {
				cause: { kind: "orphanRejected", orphans: [{ key: "vip-pass", kind: "gamePass" }] },
				kind: "buildDesiredFailed",
			},
			success: false,
		});
		expect(http.requests).toBeEmpty();
		expect(store.writes).toBeEmpty();
	});

	it.for([diffCommand, deployCommand, provisionCommand, publishCommand])(
		"should print all orphan identities and fixes and exit unsuccessfully through %s",
		async (command, { expect }) => {
			expect.hasAssertions();

			const http = createFakeHttpClient();
			const store = fakeStateStore({
				initial: {
					production: {
						environment: "production",
						resources: [gamePassCurrent(), developerProductCurrent()],
						version: 1,
					},
				},
			});
			const config = { environments: { production: {} } };
			const options = {
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			};
			const deps = makeDeps({
				deploy: async ({ credential: _credential, ...input }) => {
					return deploy({ ...input, ...options });
				},
				loadProject: async () => {
					return {
						data: { config, plugins: EMPTY_PLUGIN_REGISTRY },
						success: true,
					};
				},
				previewDiff: async (input) => previewDiffAsync({ ...input, ...options }),
				provision: async ({ credential: _credential, ...input }) => {
					return provision({ ...input, ...options });
				},
				publish: async ({ credential: _credential, ...input }) => {
					return publish({ ...input, ...options });
				},
			});
			await command(deps)({ env: "production" });

			expect(deps.exit).toHaveBeenCalledExactlyOnceWith(1);
			expect(deps.clack!.logError).toHaveBeenCalledWith(
				expect.stringContaining(
					'Unresolved orphans: gamePass:vip-pass, developerProduct:gem-pack. Restore each entry with retired: true to retire it, retired: "untrack" to stop managing it without changing Roblox, or movedFrom on its new entry to preserve its Roblox ID.',
				),
			);
			expect(http.requests).toBeEmpty();
			expect(store.writes).toBeEmpty();
		},
	);

	it.for([deploy, provision, publish, previewDiffAsync])(
		"should refuse every orphan before operations or state writes through %s",
		async (command, { expect }) => {
			expect.hasAssertions();

			const key = asResourceKey("old");
			const resources = [
				gamePassCurrent({ key }),
				developerProductCurrent({ key }),
				placeCurrent({ key }),
			];
			const initial = { environment: "production", resources, version: 1 } as const;
			const store = fakeStateStore({ initial: { production: initial } });
			const http = createFakeHttpClient().mockResponse({
				body: validDeveloperProductBody(),
				status: 200,
			});
			const result = await command({
				config: {
					environments: { production: {} },
					products: { fresh: { name: "Fresh", description: "New" } },
				},
				environment: "production",
				readFile: noFilesAsync,
				registry: registry(http),
				statePort: store.port,
			});

			expect(result).toMatchObject({
				err: {
					cause: {
						kind: "orphanRejected",
						message:
							'Unresolved orphans: gamePass:old, developerProduct:old, place:old. Restore each entry with retired: true to retire it, retired: "untrack" to stop managing it without changing Roblox, or movedFrom on its new entry to preserve its Roblox ID.',
						orphans: [
							{ key: "old", kind: "gamePass" },
							{ key: "old", kind: "developerProduct" },
							{ key: "old", kind: "place" },
						],
					},
					kind: "buildDesiredFailed",
				},
				success: false,
			});
			expect(http.requests).toBeEmpty();
			expect(store.writes).toBeEmpty();
			expect(store.states.get("production")).toStrictEqual(initial);
		},
	);
});
