import { asRobloxAssetId, asSha256Hex, createDeveloperProductDriver } from "@bedrock-rbx/core";
import { DeveloperProductsClient } from "@bedrock-rbx/ocale/developer-products";
import { createFakeHttpClient, type FakeHttpClient } from "@bedrock-rbx/ocale/testing";

import type { Except } from "type-fest";
import { assert } from "vitest";

import type { ResourceCurrentState } from "#src/core/resources";
import type { DeveloperProductEntry } from "#src/core/schema";
import type { ProgressEvent } from "#src/ports/progress-port";
import type { DriverRegistry } from "#src/ports/resource-driver";
import type { DeployOptions } from "#src/shell/deploy";
import { environmentFrom } from "#tests/helpers/environment";
import { developerProductCurrent } from "#tests/helpers/resources";
import { fakeStateStore, type FakeStateStore } from "#tests/helpers/state-store";

interface LiveProductFixture {
	readonly current: ResourceCurrentState<"developerProduct">;
	readonly events: Array<ProgressEvent>;
	readonly httpClient: FakeHttpClient;
	readonly options: Except<DeployOptions, "config" | "credential" | "registry"> & {
		readonly config: {
			environments: { production: Record<string, never> };
			products: { "gem-pack": DeveloperProductEntry };
		};
		readonly registry: DriverRegistry;
	};
	readonly store: FakeStateStore;
}

/**
 * Saved product with a local icon baseline that scalar reverts must preserve.
 * @param overrides - Saved fields for a different sale or managed-pricing mode.
 * @returns A product whose icon hashes match an empty local file.
 */
export function liveProductCurrent(
	overrides?: Partial<ResourceCurrentState<"developerProduct">>,
): ResourceCurrentState<"developerProduct"> {
	return developerProductCurrent({
		icon: { "en-us": "assets/gems.png" },
		iconFileHashes: {
			"en-us": asSha256Hex(
				"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			),
		},
		isManagedPricingEnabled: false,
		outputs: {
			iconImageAssetId: asRobloxAssetId("1122334455"),
			productId: asRobloxAssetId("8172635495"),
		},
		price: 100,
		...overrides,
	});
}

const trap = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

/**
 * Real product Driver, fake HTTP and State, with public deploy options.
 * @param httpClient - Scripted live list pages and upstream write responses.
 * @param current - Saved product; the config initially matches its managed fields.
 * @returns Observable requests, persisted State, progress events and deploy options.
 */
export function liveProductFixture(
	httpClient = createFakeHttpClient(),
	current = liveProductCurrent(),
): LiveProductFixture {
	const events: Array<ProgressEvent> = [];
	const store = fakeStateStore({
		initial: { production: { environment: "production", resources: [current], version: 1 } },
	});
	const base = { current, events, httpClient, store };
	return { ...base, options: optionsFor(base) };
}

async function emptyFileAsync(): Promise<Uint8Array> {
	await Promise.resolve();
	return new Uint8Array();
}

async function noIconUploadAsync(): Promise<never> {
	await Promise.resolve();
	throw new Error("scalar reverts must not upload local icons");
}

function productRegistry(httpClient: FakeHttpClient): DriverRegistry {
	return {
		badge: trap,
		developerProduct: createDeveloperProductDriver({
			client: new DeveloperProductsClient({
				credential: { apiKey: "fake", kind: "apiKey" },
				httpClient,
				sleep: async () => {
					await Promise.resolve();
				},
			}),
			readFile: noIconUploadAsync,
			universeId: asRobloxAssetId("123"),
		}),
		gamePass: trap,
		place: trap,
		universe: trap,
	};
}

function productEntry(current: ResourceCurrentState<"developerProduct">): DeveloperProductEntry {
	const fields = {
		name: current.name,
		description: current.description,
		...(current.icon === undefined ? {} : { icon: current.icon }),
	};
	if (current.isManagedPricingEnabled === true) {
		assert(current.price !== undefined);
		return { ...fields, isManagedPricingEnabled: true, price: current.price };
	}

	return {
		...fields,
		isManagedPricingEnabled: false,
		...(current.price === undefined ? {} : { price: current.price }),
	};
}

function optionsFor({
	current,
	events,
	httpClient,
	store,
}: Pick<
	LiveProductFixture,
	"current" | "events" | "httpClient" | "store"
>): LiveProductFixture["options"] {
	return {
		config: {
			environments: { production: {} },
			products: { "gem-pack": productEntry(current) },
		},
		environment: "production",
		getEnv: environmentFrom({}),
		progress: {
			emit: (event) => {
				events.push(event);
			},
		},
		readFile: emptyFileAsync,
		registry: productRegistry(httpClient),
		statePort: store.port,
	};
}
