import { asRobloxAssetId, createGamePassDriver } from "@bedrock-rbx/core";
import { GamePassesClient } from "@bedrock-rbx/ocale/game-passes";
import {
	createFakeHttpClient,
	type FakeHttpClient,
	validGamePassBody,
} from "@bedrock-rbx/ocale/testing";

import type { Except } from "type-fest";

import type { GamePassDesiredState, ResourceCurrentState } from "#src/core/resources";
import type { ProgressEvent } from "#src/ports/progress-port";
import type { DriverRegistry } from "#src/ports/resource-driver";
import type { DeployOptions } from "#src/shell/deploy";
import { environmentFrom } from "#tests/helpers/environment";
import { gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore, type FakeStateStore } from "#tests/helpers/state-store";

interface FixtureConfig {
	environments: { production: Record<string, never> };
	passes: {
		"vip-pass": Pick<GamePassDesiredState, "description" | "icon" | "name"> & { price: number };
	};
}
interface LivePassFixture {
	readonly current: ResourceCurrentState<"gamePass">;
	readonly events: Array<ProgressEvent>;
	readonly httpClient: FakeHttpClient;
	readonly options: Except<DeployOptions, "config" | "credential" | "registry"> & {
		readonly config: FixtureConfig;
		readonly registry: DriverRegistry;
	};
	readonly store: FakeStateStore;
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
 * A real game-pass Driver with a saved price of 500 and a configurable live price.
 * @param price - Price returned by the live list.
 * @param httpClient - Optional scripted transport for read or write failures.
 * @returns HTTP, State, progress and deploy options for integration tests.
 */
export function livePassFixture(
	price = 120,
	httpClient = passHttp(gamePassCurrent(), price),
): LivePassFixture {
	const current = gamePassCurrent();
	const base = {
		current,
		events: [],
		httpClient,
		store: fakeStateStore({
			initial: {
				production: { environment: "production", resources: [current], version: 1 },
			},
		}),
	};
	return { ...base, options: optionsFor(base) };
}

function passHttp(current: ResourceCurrentState<"gamePass">, price: number): FakeHttpClient {
	return createFakeHttpClient()
		.mockResponse({
			body: {
				gamePasses: [
					validGamePassBody({
						name: current.name,
						description: current.description,
						gamePassId: 9_876_543_210,
						iconAssetId: 1_122_334_455,
						priceInformation: { defaultPriceInRobux: price, enabledFeatures: [] },
					}),
				],
				// eslint-disable-next-line unicorn/no-null -- Terminal Roblox list page.
				nextPageToken: null,
			},
			status: 200,
		})
		.mockResponse({ status: 204 });
}

async function emptyFileAsync(): Promise<Uint8Array> {
	await Promise.resolve();
	return new Uint8Array();
}

function passRegistry(httpClient: FakeHttpClient): DriverRegistry {
	return {
		badge: trap,
		developerProduct: trap,
		gamePass: createGamePassDriver({
			client: new GamePassesClient({
				credential: { apiKey: "fake", kind: "apiKey" },
				httpClient,
				sleep: async () => {
					await Promise.resolve();
				},
			}),
			readFile: emptyFileAsync,
			universeId: asRobloxAssetId("123"),
		}),
		place: trap,
		universe: trap,
	};
}

function optionsFor({
	current,
	events,
	httpClient,
	store,
}: Pick<
	LivePassFixture,
	"current" | "events" | "httpClient" | "store"
>): LivePassFixture["options"] {
	return {
		config: {
			environments: { production: {} },
			passes: {
				"vip-pass": {
					name: current.name,
					description: current.description,
					icon: current.icon,
					price: 500,
				},
			},
		},
		environment: "production",
		getEnv: environmentFrom({}),
		progress: {
			emit: (event) => {
				events.push(event);
			},
		},
		readFile: emptyFileAsync,
		registry: passRegistry(httpClient),
		statePort: store.port,
	};
}
