import { assert, describe, it } from "vitest";

import { gamePassCurrent } from "#tests/helpers/resources";
import { fakeStateStore } from "#tests/helpers/state-store";
import type { ResolvedConfig } from "../core/schema.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import { asRobloxAssetId } from "../types/ids.ts";
import { importIntoStatePortAsync } from "./import-live.ts";

const trap = {
	create() {
		throw new Error("Unexpected create");
	},
	retire() {
		throw new Error("Unexpected retire");
	},
};

const REGISTRY: DriverRegistry = {
	badge: trap,
	developerProduct: trap,
	gamePass: {
		...trap,
		read: async () => {
			return {
				data: {
					name: "VIP Pass",
					description: "Grants VIP perks.",
					isManagedPricingEnabled: false,
					kind: "gamePass",
					outputs: { iconAssetIds: { "en-us": asRobloxAssetId("1122334455") } },
					price: 500,
				},
				success: true,
			};
		},
	},
	place: trap,
	universe: trap,
};

const CONFIG: ResolvedConfig = {
	environments: {
		production: {
			passes: {
				"vip-pass": { iconBaseline: "accept-local-file", importId: "9876543210" },
			},
		},
	},
	orphans: "error",
	passes: {
		"vip-pass": {
			name: "VIP Pass",
			description: "Grants VIP perks.",
			icon: { "en-us": "assets/vip-icon.png" },
			isManagedPricingEnabled: false,
			price: 500,
		},
	},
};

describe(importIntoStatePortAsync, () => {
	it("should read the backend State once the run has written", async ({ expect }) => {
		expect.hasAssertions();

		const store = fakeStateStore();
		const result = await importIntoStatePortAsync(
			{
				config: CONFIG,
				environment: "production",
				readFile: async () => new Uint8Array(),
				registry: REGISTRY,
			},
			store.port,
		);
		assert(result.success);
		const before = await result.data.statePort.read("production");
		const written = {
			environment: "production",
			resources: [gamePassCurrent({ name: "Written by the run" })],
			version: 1,
		} as const;
		await result.data.statePort.write(written, undefined);
		const after = await result.data.statePort.read("production");

		expect(before).toMatchObject({ data: { state: { resources: [{ key: "vip-pass" }] } } });
		expect(after).toMatchObject({ data: { state: written } });
		expect(store.writes).toHaveLength(1);
	});
});
