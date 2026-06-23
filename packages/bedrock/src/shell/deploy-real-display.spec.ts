import { assert, describe, expect, it, vi } from "vitest";

import { codegenView, realValue } from "../core/codegen-view.ts";
import type { EmitInput } from "../core/codegen.ts";
import {
	REDACTED_DESCRIPTION,
	REDACTED_PASS_NAME,
	REDACTED_PRICE,
} from "../core/redact-resources.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import type { CodegenWriterPort } from "../ports/codegen-writer.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asRobloxAssetId } from "../types/ids.ts";
import { deploy } from "./deploy.ts";

const Outputs = {
	assetId: asRobloxAssetId("9876543210"),
	iconAssetIds: { "en-us": asRobloxAssetId("1122334455") },
} as const;

const developerProductStub: ResourceDriver<"developerProduct"> = {
	async create() {
		throw new Error("developerProduct driver must not run for this fixture");
	},
};

const placeStub: ResourceDriver<"place"> = {
	async create() {
		throw new Error("place driver must not run for this fixture");
	},
};

const universeStub: ResourceDriver<"universe"> = {
	async create() {
		throw new Error("universe driver must not run for this fixture");
	},
};

async function readIcon(): Promise<Uint8Array> {
	return new Uint8Array();
}

function echoGamePassDriver(): ResourceDriver<"gamePass"> {
	return {
		async create(desired) {
			return { data: { ...desired, outputs: Outputs }, success: true };
		},
	};
}

function inMemoryStatePort(initial?: BedrockState): {
	port: StatePort;
	writes: Array<BedrockState>;
} {
	let current = initial;
	const writes: Array<BedrockState> = [];
	return {
		port: {
			async read() {
				return { data: current, success: true };
			},
			async write(state) {
				writes.push(state);
				current = state;
				return { data: undefined, success: true };
			},
		},
		writes,
	};
}

function redactedVipConfig(realName: string, codegen = false): Config {
	return {
		...(codegen ? { codegen: { enabled: true, output: "out" } } : {}),
		environments: { production: {} },
		passes: {
			"vip-pass": {
				name: realName,
				description: "Grants VIP perks.",
				icon: { "en-us": "assets/vip-icon.png" },
				price: 500,
				redacted: true,
			},
		},
	};
}

function registryWith(gamePass: ResourceDriver<"gamePass">): DriverRegistry {
	return {
		developerProduct: developerProductStub,
		gamePass,
		place: placeStub,
		universe: universeStub,
	};
}

describe("deploy persists real display values", () => {
	it("should attach the real display values for a redacted resource to the persisted state", async () => {
		expect.assertions(1);

		const { port } = inMemoryStatePort();

		const result = await deploy({
			config: redactedVipConfig("VIP Pass"),
			environment: "production",
			readFile: readIcon,
			registry: registryWith(echoGamePassDriver()),
			statePort: port,
		});

		assert(result.success);

		expect(result.data.realDisplay).toStrictEqual({
			"gamePass:vip-pass": {
				name: "VIP Pass",
				description: "Grants VIP perks.",
				price: 500,
			},
		});
	});

	it("should push placeholders to the driver while persisting the real values out of band", async () => {
		expect.assertions(2);

		const create = vi
			.fn<ResourceDriver<"gamePass">["create"]>()
			.mockImplementation(async (desired) => {
				return { data: { ...desired, outputs: Outputs }, success: true };
			});
		const { port } = inMemoryStatePort();

		const result = await deploy({
			config: redactedVipConfig("VIP Pass"),
			environment: "production",
			readFile: readIcon,
			registry: registryWith({ create }),
			statePort: port,
		});

		assert(result.success);
		const pushed = create.mock.calls[0]![0];

		expect(pushed.name).toBe(REDACTED_PASS_NAME);
		expect(result.data.resources[0]).toMatchObject({
			name: REDACTED_PASS_NAME,
			description: REDACTED_DESCRIPTION,
			price: REDACTED_PRICE,
		});
	});

	it("should expose the real value to a codegen emitter through the projected view", async () => {
		expect.assertions(2);

		let captured: EmitInput | undefined;
		const writer: CodegenWriterPort = {
			async write() {
				return { data: undefined, success: true };
			},
		};
		const { port } = inMemoryStatePort();

		await deploy({
			codegenWriter: writer,
			config: redactedVipConfig("VIP Pass", true),
			emit(input) {
				captured = input;
				return [];
			},
			environment: "production",
			readFile: readIcon,
			registry: registryWith(echoGamePassDriver()),
			statePort: port,
		});

		assert(captured !== undefined);
		const state = captured.environments["production"]!;
		const resource = state.resources[0] as ResourceCurrentState<"gamePass">;
		const view = codegenView(resource, state.realDisplay?.["gamePass:vip-pass"]);

		expect(realValue(view.name)).toBe("VIP Pass");
		expect(realValue(view.price)).toBe(500);
	});

	it("should diff a redacted resource as a noop when only its real value changes", async () => {
		expect.assertions(3);

		const first = inMemoryStatePort();
		await deploy({
			config: redactedVipConfig("VIP Pass"),
			environment: "production",
			readFile: readIcon,
			registry: registryWith(echoGamePassDriver()),
			statePort: first.port,
		});

		const prior = first.writes[0]!;
		const create = vi.fn<ResourceDriver<"gamePass">["create"]>();
		const update = vi.fn<NonNullable<ResourceDriver<"gamePass">["update"]>>();
		const second = inMemoryStatePort(prior);

		const result = await deploy({
			config: redactedVipConfig("VIP Pass Renamed"),
			environment: "production",
			readFile: readIcon,
			registry: registryWith({ create, update }),
			statePort: second.port,
		});

		assert(result.success);

		expect(create).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
		expect(result.data.realDisplay?.["gamePass:vip-pass"]?.name).toBe("VIP Pass Renamed");
	});
});
