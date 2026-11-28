import {
	asRobloxAssetId,
	createPlaceDriver,
	createUniverseDriver,
	deploy,
} from "@bedrock-rbx/core";
import { PlacesClient } from "@bedrock-rbx/ocale/places";
import {
	createFakeHttpClient,
	validPlaceBody,
	validUniverseBody,
} from "@bedrock-rbx/ocale/testing";
import { UniversesClient } from "@bedrock-rbx/ocale/universes";

import { assert, describe, it, vi } from "vitest";

import { diffCommand } from "#src/cli/commands/diff";
import { EMPTY_PLUGIN_REGISTRY } from "#src/core/plugin-registry";
import type { ResourceCurrentState } from "#src/core/resources";
import type { Config } from "#src/core/schema";
import type { ProgressEvent } from "#src/ports/progress-port";
import type { DriverRegistry } from "#src/ports/resource-driver";
import { previewDiffAsync } from "#src/shell/preview-diff";
import { environmentFrom } from "#tests/helpers/environment";
import { jsonRequestBody } from "#tests/helpers/http";
import { makeDeps } from "#tests/helpers/reconcile-command";
import { fakeStateStore } from "#tests/helpers/state-store";

const UNIVERSE_ID = "1234567890";

const URL_ORDER = new Intl.Collator("en");

const unused = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

function universeBody(startPlaceId: string): unknown {
	return validUniverseBody({
		path: `universes/${UNIVERSE_ID}`,
		rootPlace: `universes/${UNIVERSE_ID}/places/${startPlaceId}`,
	});
}

function withPlaceReads(
	httpClient: ReturnType<typeof createFakeHttpClient>,
	count: number,
): ReturnType<typeof createFakeHttpClient> {
	return Array.from({ length: count }).reduce<ReturnType<typeof createFakeHttpClient>>(
		(client) => client.mockResponse({ body: validPlaceBody(), status: 200 }),
		httpClient,
	);
}

function priorityFixture(
	{ config, resources = [] }: { config: Config; resources?: ReadonlyArray<ResourceCurrentState> },
	httpClient: ReturnType<typeof createFakeHttpClient>,
) {
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources, version: 1 } },
	});
	const events: Array<ProgressEvent> = [];
	const clientOptions = {
		credential: { apiKey: "fake", kind: "apiKey" } as const,
		httpClient,
		sleep: async () => {},
	};
	const places = new PlacesClient(clientOptions);
	async function readFile(): Promise<Uint8Array> {
		throw new Error("readFile must not run for config-only places");
	}

	const registry = {
		badge: unused,
		developerProduct: unused,
		gamePass: unused,
		place: createPlaceDriver({
			client: places,
			readFile,
			universeId: asRobloxAssetId(UNIVERSE_ID),
		}),
		universe: createUniverseDriver({ places, universes: new UniversesClient(clientOptions) }),
	} satisfies DriverRegistry;
	return {
		events,
		options: {
			config,
			environment: "production",
			getEnv: environmentFrom({}),
			progress: {
				emit: (event: ProgressEvent) => {
					events.push(event);
				},
			},
			readFile,
			registry,
			statePort: store.port,
		},
		store,
	};
}

function displayNamePatches(
	httpClient: ReturnType<typeof createFakeHttpClient>,
): ReadonlyArray<readonly [string, unknown]> {
	return httpClient.requests
		.filter(({ request }) => request.method === "PATCH" && request.url.includes("/places/"))
		.map(({ request }) => {
			return [
				request.url.slice(0, request.url.indexOf("?")),
				jsonRequestBody(request)["displayName"],
			] as const;
		})
		.toSorted(([left], [right]) => URL_ORDER.compare(left, right));
}

const BOTH_NAMES = {
	environments: {
		production: {
			places: { "lobby": { placeId: "4712" }, "start-place": { placeId: "4711" } },
		},
	},
	places: { "lobby": { displayName: "Side lobby" }, "start-place": { displayName: "Lobby" } },
	universe: { displayName: "My Experience", universeId: UNIVERSE_ID },
} satisfies Config;

describe("universe display name priority", () => {
	it("should give the live start place the universe display name and warn about the place key", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = withPlaceReads(
			createFakeHttpClient().mockResponse({ body: universeBody("4711"), status: 200 }),
			4,
		)
			.mockResponse({ body: universeBody("4711"), status: 200 })
			.mockResponse({ body: validPlaceBody(), status: 200 })
			.mockResponse({ body: validPlaceBody(), status: 200 });
		const fixture = priorityFixture({ config: BOTH_NAMES }, http);

		const result = await deploy(fixture.options);
		assert(result.success, JSON.stringify(result));

		expect(displayNamePatches(http)).toStrictEqual([
			[`/cloud/v2/universes/${UNIVERSE_ID}/places/4711`, "My Experience"],
			[`/cloud/v2/universes/${UNIVERSE_ID}/places/4712`, "Side lobby"],
		]);
		expect(
			fixture.events.filter(({ kind }) => kind === "startPlaceFieldSkipped"),
		).toStrictEqual([
			{
				key: "start-place",
				environment: "production",
				field: "displayName",
				kind: "startPlaceFieldSkipped",
			},
		]);
	});

	it("should give the start place its own display name when the universe declares none", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = withPlaceReads(createFakeHttpClient(), 2)
			.mockResponse({ body: universeBody("4711"), status: 200 })
			.mockResponse({ body: validPlaceBody(), status: 200 });
		const fixture = priorityFixture(
			{
				config: {
					environments: {
						production: { places: { "start-place": { placeId: "4711" } } },
					},
					places: { "start-place": { displayName: "Lobby" } },
					universe: { universeId: UNIVERSE_ID },
				},
			},
			http,
		);

		const result = await deploy(fixture.options);
		assert(result.success, JSON.stringify(result));

		expect(displayNamePatches(http)).toStrictEqual([
			[`/cloud/v2/universes/${UNIVERSE_ID}/places/4711`, "Lobby"],
		]);
		expect(fixture.events.map(({ kind }) => kind)).not.toContain("startPlaceFieldSkipped");
	});

	it("should fail the deploy before any write when the start place cannot be read", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient().mockApiError({ message: "refused", statusCode: 403 });
		const fixture = priorityFixture({ config: BOTH_NAMES }, http);

		const result = await deploy(fixture.options);

		expect(result).toMatchObject({
			err: { kind: "liveCheckFailed", resourceKind: "universe" },
			success: false,
		});
		expect(http.requests).toHaveLength(1);
	});

	it("should keep each place display name when the universe driver cannot read", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockResponse({ body: universeBody("4711"), status: 200 })
			.mockResponse({ body: validPlaceBody(), status: 200 })
			.mockResponse({ body: validPlaceBody(), status: 200 })
			.mockResponse({ body: validPlaceBody(), status: 200 });
		const fixture = priorityFixture({ config: BOTH_NAMES }, http);
		const { read, ...unreadable } = fixture.options.registry.universe;
		assert(read !== undefined);

		const result = await deploy({
			...fixture.options,
			live: false,
			registry: { ...fixture.options.registry, universe: unreadable },
		});
		assert(result.success, JSON.stringify(result));

		expect(displayNamePatches(http)).toStrictEqual([
			[`/cloud/v2/universes/${UNIVERSE_ID}/places/4711`, "My Experience"],
			[`/cloud/v2/universes/${UNIVERSE_ID}/places/4711`, "Lobby"],
			[`/cloud/v2/universes/${UNIVERSE_ID}/places/4712`, "Side lobby"],
		]);
		expect(fixture.events.map(({ kind }) => kind)).not.toContain("startPlaceFieldSkipped");
	});

	it("should skip no place field when the universe is not found", async ({ expect }) => {
		expect.hasAssertions();

		const http = createFakeHttpClient()
			.mockApiError({ message: "not found", statusCode: 404 })
			.mockApiError({ message: "not found", statusCode: 404 })
			.mockResponse({ body: validPlaceBody(), status: 200 })
			.mockResponse({ body: validPlaceBody(), status: 200 });
		const fixture = priorityFixture({ config: BOTH_NAMES }, http);

		const result = await deploy({ ...fixture.options, live: false });

		expect(result).toMatchObject({ err: { kind: "applyFailed" }, success: false });
		expect(displayNamePatches(http)).toStrictEqual([
			[`/cloud/v2/universes/${UNIVERSE_ID}/places/4711`, "Lobby"],
			[`/cloud/v2/universes/${UNIVERSE_ID}/places/4712`, "Side lobby"],
		]);
		expect(fixture.events.map(({ kind }) => kind)).not.toContain("startPlaceFieldSkipped");
	});

	it("should give the former start place its own display name once the start place changes", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const http = withPlaceReads(
			createFakeHttpClient().mockResponse({ body: universeBody("4711"), status: 200 }),
			4,
		)
			.mockResponse({ body: universeBody("4711"), status: 200 })
			.mockResponse({ body: validPlaceBody(), status: 200 })
			.mockResponse({ body: validPlaceBody(), status: 200 });
		const fixture = priorityFixture({ config: BOTH_NAMES }, http);
		const first = await deploy(fixture.options);
		assert(first.success, JSON.stringify(first));
		const before = http.requests.length;
		http.mockResponse({ body: universeBody("4712"), status: 200 }).mockResponse({
			body: validPlaceBody(),
			status: 200,
		});
		fixture.events.length = 0;

		const second = await deploy({ ...fixture.options, live: false });
		assert(second.success, JSON.stringify(second));

		expect(
			http.requests
				.slice(before)
				.filter(({ request }) => request.method === "PATCH")
				.map(({ request }) => [request.url, jsonRequestBody(request)["displayName"]]),
		).toStrictEqual([
			[`/cloud/v2/universes/${UNIVERSE_ID}/places/4711?updateMask=displayName`, "Lobby"],
		]);
		expect(
			fixture.events.filter(({ kind }) => kind === "startPlaceFieldSkipped"),
		).toMatchObject([{ key: "lobby", field: "displayName" }]);
	});
});

async function deployedPreviewAsync() {
	const http = withPlaceReads(
		createFakeHttpClient().mockResponse({ body: universeBody("4711"), status: 200 }),
		4,
	)
		.mockResponse({ body: universeBody("4711"), status: 200 })
		.mockResponse({ body: validPlaceBody(), status: 200 })
		.mockResponse({ body: validPlaceBody(), status: 200 });
	const fixture = priorityFixture({ config: BOTH_NAMES }, http);
	const deployed = await deploy(fixture.options);
	assert(deployed.success, JSON.stringify(deployed));
	withPlaceReads(http.mockResponse({ body: universeBody("4711"), status: 200 }), 2).mockResponse({
		body: universeBody("4711"),
		status: 200,
	});
	const { progress, ...options } = fixture.options;
	return { options, preview: await previewDiffAsync({ ...options, live: true }) };
}

describe("universe display name priority in a diff preview", () => {
	it("should plan no display name update on the start place the universe names", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { preview } = await deployedPreviewAsync();
		assert(preview.success, JSON.stringify(preview));

		expect(
			preview.data.drift!.filter(({ type }) => type !== "noop").map(({ key }) => key),
		).toStrictEqual([]);
		expect(preview.data.startPlaceFieldSkips).toStrictEqual([
			{
				key: "start-place",
				environment: "production",
				field: "displayName",
				kind: "startPlaceFieldSkipped",
			},
		]);
	});

	it("should warn in the diff output about the start place key the universe overrides", async ({
		expect,
	}) => {
		expect.hasAssertions();

		const { options, preview } = await deployedPreviewAsync();
		const deps = makeDeps({
			loadProject: async () => {
				return {
					data: { config: options.config, plugins: EMPTY_PLUGIN_REGISTRY },
					success: true,
				};
			},
			previewDiff: async () => preview,
		});
		await diffCommand(deps)({ env: ["production"] });

		expect(deps.clack!.logMessage).toHaveBeenCalledWith(
			"Warning: place:start-place displayName is not used; universe.displayName wins on the start place.",
		);
	});
});

function stubOpenCloud(onTestFinished: (callback: () => void) => void): Array<string> {
	const urls: Array<string> = [];
	vi.stubGlobal("fetch", async (input: Request | string) => {
		const url = typeof input === "string" ? input : input.url;
		urls.push(url);
		return Response.json(url.includes("/places/") ? validPlaceBody() : universeBody("4711"));
	});
	onTestFinished(() => {
		vi.unstubAllGlobals();
	});
	return urls;
}

async function firstPreviewAsync(config: Config) {
	return previewDiffAsync({
		config,
		credential: { apiKey: "fake", kind: "apiKey" },
		environment: "production",
		getEnv: environmentFrom({}),
		statePort: fakeStateStore().port,
	});
}

describe("universe display name priority in a first diff preview", () => {
	it("should warn about the start place key before the first deploy", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		const urls = stubOpenCloud(onTestFinished);

		const preview = await firstPreviewAsync(BOTH_NAMES);
		assert(preview.success, JSON.stringify(preview));

		expect(urls).toStrictEqual([
			`https://apis.roblox.com/cloud/v2/universes/${UNIVERSE_ID}`,
			"https://apis.roblox.com/assets/v1/assets/4711?readMask=icon",
		]);
		expect(preview.data.startPlaceFieldSkips).toStrictEqual([
			{
				key: "start-place",
				environment: "production",
				field: "displayName",
				kind: "startPlaceFieldSkipped",
			},
		]);
	});

	it("should read nothing before the first deploy when only the universe declares a display name", async ({
		expect,
		onTestFinished,
	}) => {
		expect.hasAssertions();

		const urls = stubOpenCloud(onTestFinished);

		const preview = await firstPreviewAsync({
			...BOTH_NAMES,
			places: { "lobby": {}, "start-place": {} },
		});
		assert(preview.success, JSON.stringify(preview));

		expect(urls).toBeEmpty();
		expect(preview.data.startPlaceFieldSkips).toBeEmpty();
	});
});
