import {
	asRobloxAssetId,
	createBadgeDriver,
	createDeveloperProductDriver,
	createGamePassDriver,
	type DeployOptions,
	type DriverRegistry,
	type ProgressEvent,
	type ResourceCurrentState,
} from "@bedrock-rbx/core";
import { BadgesClient } from "@bedrock-rbx/ocale/badges";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validBadgeBody,
	validDeveloperProductBody,
	validGamePassBody,
} from "@bedrock-rbx/ocale/testing";

import { assert } from "vitest";

import { environmentFrom } from "#tests/helpers/environment";
import { liveProductCurrent } from "#tests/helpers/live-developer-product";
import { badgeCurrent, gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore, type FakeStateStore } from "#tests/helpers/state-store";
import { fakeUniverses } from "#tests/helpers/universe-owner";

/** Kinds with locally managed source-language icons. */
export type IconKind = "badge" | "developerProduct" | "gamePass";
/** Saved resource at the icon-restoration seam. */
export type IconCurrent = ResourceCurrentState<IconKind>;
/** Expected transport contracts for the three icon write APIs. */
export const ICON_CASES = [
	{ field: "file", kind: "gamePass", methods: ["GET", "PATCH", "GET", "GET"], uploadIndex: 1 },
	{
		field: "imageFile",
		kind: "developerProduct",
		methods: ["GET", "PATCH", "GET", "GET"],
		uploadIndex: 1,
	},
	{ field: "Files", kind: "badge", methods: ["GET", "PATCH", "POST", "GET"], uploadIndex: 2 },
] as const;

interface IconRead {
	readonly id: number | undefined;
	readonly description?: string;
}
interface FixtureOptions {
	readonly current?: IconCurrent;
	readonly httpClient?: FakeHttpClient;
	readonly readFile?: (path: string) => Promise<Uint8Array>;
}
interface LiveIconFixture {
	readonly current: IconCurrent;
	readonly events: Array<ProgressEvent>;
	readonly httpClient: FakeHttpClient;
	readonly options: DeployOptions & {
		readonly config: NonNullable<DeployOptions["config"]>;
		readonly registry: DriverRegistry;
	};
	readonly store: FakeStateStore;
}
const trap = {
	create(): never {
		throw new Error("Unexpected create");
	},
	retire(): never {
		throw new Error("Unexpected retire");
	},
};

/**
 * Saved resource with an empty-file hash and a known icon asset ID.
 * @param kind - Kind under test.
 * @returns Saved Current state.
 */
export function iconCurrent(kind: IconKind): IconCurrent {
	switch (kind) {
		case "badge": {
			return badgeCurrent();
		}
		case "developerProduct": {
			return liveProductCurrent();
		}
		case "gamePass": {
			return gamePassCurrent({ isManagedPricingEnabled: false });
		}
	}
}

/**
 * Read the source-language icon ID without depending on each Output shape.
 * @param current - Resource returned or persisted by deploy.
 * @returns The saved icon ID, absent on Kinds without icons.
 */
export function iconId(current: ResourceCurrentState): string | undefined {
	switch (current.kind) {
		case "badge": {
			return current.outputs.iconImageId;
		}
		case "developerProduct": {
			return current.outputs.iconImageAssetId;
		}
		case "gamePass": {
			return current.outputs.iconAssetIds["en-us"];
		}
		case "place":
		case "universe": {
			return undefined;
		}
	}
}

/**
 * Roblox source-language fields for one tracked resource.
 * @param current - Managed fields and resource ID.
 * @param read - Live icon ID and optional changed description.
 * @returns A schema-valid Roblox response body.
 */
export function iconWire(
	current: IconCurrent,
	{ id, description = current.description }: IconRead,
): unknown {
	const fields = { name: current.name, description };
	switch (current.kind) {
		case "badge": {
			return badgeWire(current, { id, description });
		}
		case "developerProduct": {
			return {
				...validDeveloperProductBody({
					...fields,
					...priceFields(current),
					productId: Number(current.outputs.productId),
				}),
				iconImageAssetId: id ?? JSON.parse("null"),
			};
		}
		case "gamePass": {
			return validGamePassBody({
				...fields,
				gamePassId: Number(current.outputs.assetId),
				iconAssetId: id ?? 0,
				...priceFields(current),
			});
		}
	}
}

/**
 * One terminal list page for the tracked resource.
 * @param current - Managed resource.
 * @param read - Live icon ID and optional changed description.
 * @returns A complete list response.
 */
export function iconPage(current: IconCurrent, read: IconRead): Record<string, unknown> {
	const item = iconWire(current, read);
	switch (current.kind) {
		case "badge": {
			return { data: [item] };
		}
		case "developerProduct": {
			return { developerProducts: [item], nextPageToken: JSON.parse("null") };
		}
		case "gamePass": {
			return { gamePasses: [item], nextPageToken: JSON.parse("null") };
		}
	}
}

/**
 * Queue a successful icon update and its authoritative new ID response.
 * @param http - Scripted HTTP boundary.
 * @param inputs - Managed resource and returned ID/description.
 * @returns The same scripted client for chaining a settled next read.
 */
export function iconUpdate(
	http: FakeHttpClient,
	{
		id = 777,
		current,
		description,
	}: { readonly current: IconCurrent; readonly description?: string; readonly id?: number },
): FakeHttpClient {
	return http.mockResponse({ status: current.kind === "badge" ? 200 : 204 }).mockResponse({
		body:
			current.kind === "badge"
				? { targetId: id }
				: iconWire(current, { id, ...(description === undefined ? {} : { description }) }),
		status: 200,
	});
}

/**
 * Config that initially agrees with the saved resource.
 * @param current - Saved managed fields.
 * @param description - Optional reviewed config change.
 * @returns Public deploy config.
 */
export function iconConfig(
	current: IconCurrent,
	description = current.description,
): NonNullable<DeployOptions["config"]> {
	assert(current.icon !== undefined);
	const entry = { name: current.name, description, icon: current.icon };
	const environments = { production: {} };
	const price = "price" in current && current.price !== undefined ? { price: current.price } : {};
	switch (current.kind) {
		case "badge": {
			return {
				badges: { [current.key]: { ...entry, enabled: current.enabled } },
				environments,
			};
		}
		case "developerProduct": {
			return {
				environments,
				products: { [current.key]: { ...entry, ...price } },
			};
		}
		case "gamePass": {
			return {
				environments,
				passes: { [current.key]: { ...entry, ...price } },
			};
		}
	}
}

/**
 * Real Driver with scripted HTTP, fake State and progress observations.
 * @param kind - Kind under test.
 * @param inputs - Optional saved baseline, transport and filesystem boundary.
 * @returns Public preview/deploy inputs and their observable boundaries.
 */
export function liveIconFixture(
	kind: IconKind,
	{
		current = iconCurrent(kind),
		httpClient = createFakeHttpClient(),
		readFile = emptyFileAsync,
	}: FixtureOptions = {},
): LiveIconFixture {
	const events: Array<ProgressEvent> = [];
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources: [current], version: 1 } },
	});
	return {
		current,
		events,
		httpClient,
		options: {
			config: iconConfig(current),
			environment: "production",
			getEnv: environmentFrom({}),
			progress: {
				emit: (event) => {
					events.push(event);
				},
			},
			readFile,
			registry: iconRegistry(current.kind, { httpClient, readFile }),
			statePort: store.port,
		},
		store,
	};
}

function priceFields(current: ResourceCurrentState<"developerProduct" | "gamePass">): {
	readonly isForSale: boolean;
	readonly priceInformation: {
		readonly defaultPriceInRobux: number;
		readonly enabledFeatures: [];
	};
} {
	return {
		isForSale: current.price !== undefined,
		priceInformation: { defaultPriceInRobux: current.price ?? 0, enabledFeatures: [] },
	};
}

function badgeWire(
	current: ResourceCurrentState<"badge">,
	{ id, description }: IconRead,
): Record<string, unknown> {
	const { awarder: _awarder, ...body } = validBadgeBody({
		id: Number(current.outputs.badgeId),
		name: current.name,
		description: description ?? current.description,
		enabled: current.enabled,
		iconImageId: id ?? 0,
	});
	return { ...body, awardingUniverse: { id: 123, name: "Game", rootPlaceId: 456 } };
}

async function emptyFileAsync(): Promise<Uint8Array> {
	await Promise.resolve();
	return new Uint8Array();
}

function iconRegistry(
	kind: IconKind,
	{ httpClient, readFile }: Required<Pick<FixtureOptions, "httpClient" | "readFile">>,
): DriverRegistry {
	const options = {
		credential: { apiKey: "fake", kind: "apiKey" } as const,
		httpClient,
		sleep: async () => {
			await Promise.resolve();
		},
	};
	const deps = { readFile, universeId: asRobloxAssetId("123") };
	const drivers = {
		badge: createBadgeDriver({
			...deps,
			client: new BadgesClient(options),
			universes: fakeUniverses(),
		}),
		developerProduct: createDeveloperProductDriver({
			...deps,
			client: new DeveloperProductsClient(options),
		}),
		gamePass: createGamePassDriver({ ...deps, client: new GamePassesClient(options) }),
	};
	return {
		badge: trap,
		developerProduct: trap,
		gamePass: trap,
		[kind]: drivers[kind],
		place: trap,
		universe: trap,
	};
}
