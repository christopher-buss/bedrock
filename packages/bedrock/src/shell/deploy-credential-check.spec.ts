import type { Credential } from "@bedrock-rbx/ocale";

import { assert, describe, it, vi } from "vitest";

import { environmentFrom } from "#tests/helpers/environment";
import { universeCurrent } from "#tests/helpers/resources";
import { fakeStateLock } from "#tests/helpers/state-lock";
import type { CodegenFile } from "../core/codegen.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import type { CodegenWriterPort } from "../ports/codegen-writer.ts";
import type { StatePort } from "../ports/state-port.ts";
import { asResourceKey, asRobloxAssetId } from "../types/ids.ts";
import { deploy, publish } from "./deploy.ts";

const startPlace = asResourceKey("start-place");

async function readBytesAsync(): Promise<Uint8Array> {
	return new Uint8Array([1, 2, 3]);
}

function statePortWith(state: BedrockState): StatePort {
	let current = state;
	return {
		async read() {
			return { data: { state: current }, success: true };
		},
		async write(next) {
			current = next;
			return { data: undefined, success: true };
		},
	};
}

function recordingCodegenWriter(): { port: CodegenWriterPort; writes: Array<CodegenFile> } {
	const writes: Array<CodegenFile> = [];
	return {
		port: {
			async write(file) {
				writes.push(file);
				return { data: undefined, success: true };
			},
		},
		writes,
	};
}

function universeOnlyState(overrides?: Partial<BedrockState>): BedrockState {
	return {
		environment: "production",
		resources: [universeCurrent({ universeId: asRobloxAssetId("1") })],
		version: 1,
		...overrides,
	};
}

function oauthCredential(): { calls: Array<string>; credential: Credential } {
	const calls: Array<string> = [];
	return {
		calls,
		credential: {
			getAccessToken: () => {
				calls.push("getAccessToken");
				throw new Error("token provider down");
			},
			identity: "user-1",
			kind: "oauth",
		},
	};
}

function placeConfig(): Config {
	return {
		environments: { production: { places: { "start-place": { placeId: "4711" } } } },
		places: { "start-place": { filePath: "places/start.rbxl" } },
		universe: { universeId: "1" },
	};
}

function passConfig(): Config {
	return {
		environments: { production: {} },
		passes: {
			"vip-pass": {
				name: "VIP Pass",
				description: "Grants VIP perks.",
				icon: { "en-us": "assets/vip-icon.png" },
				price: 500,
			},
		},
		universe: { universeId: "1" },
	};
}

describe("oauth pre-write check", () => {
	it("should fail an OAuth deploy that would publish a place before any token is asked", async ({
		expect,
	}) => {
		expect.assertions(3);

		const { calls, credential } = oauthCredential();
		const lock = fakeStateLock();

		const result = await deploy({
			config: placeConfig(),
			credential,
			environment: "production",
			getEnv: environmentFrom({}),
			readFile: readBytesAsync,
			stateLockPort: lock.port,
			statePort: statePortWith(universeOnlyState()),
		});

		assert(!result.success);

		expect(result.err).toStrictEqual({ kind: "credentialNotSupported", places: [startPlace] });
		expect(calls).toStrictEqual([]);
		expect(lock.released).toStrictEqual(["production"]);
	});

	it("should run an OAuth deploy that publishes no place", async ({ expect }) => {
		expect.assertions(2);

		const { calls, credential } = oauthCredential();

		const result = await deploy({
			config: {
				...passConfig(),
				environments: { production: { places: { "start-place": { placeId: "4711" } } } },
				places: { "start-place": { displayName: "Start" } },
			},
			credential,
			environment: "production",
			getEnv: environmentFrom({}),
			readFile: readBytesAsync,
			statePort: statePortWith(universeOnlyState()),
		});

		assert(!result.success);

		expect(result.err.kind).toBe("applyFailed");
		expect(calls).not.toStrictEqual([]);
	});

	it("should leave an API-key deploy that publishes a place unchanged", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		vi.stubGlobal("fetch", async () => Response.json({ message: "rejected" }, { status: 400 }));
		onTestFinished(() => {
			vi.unstubAllGlobals();
		});

		const result = await deploy({
			config: placeConfig(),
			credential: { apiKey: "rbx-test", kind: "apiKey" },
			environment: "production",
			getEnv: environmentFrom({}),
			readFile: readBytesAsync,
			statePort: statePortWith(universeOnlyState()),
		});

		assert(!result.success);

		expect(result.err.kind).toBe("applyFailed");
	});

	it("should fail an OAuth codegen deploy with a buildable place before provision", async ({
		expect,
	}) => {
		expect.assertions(4);

		const { calls, credential } = oauthCredential();
		const builds: Array<string> = [];
		const codegen = recordingCodegenWriter();

		const result = await deploy({
			build: async ({ environment }) => {
				builds.push(environment);
			},
			codegenWriter: codegen.port,
			config: {
				codegen: { enabled: true, output: "src/generated" },
				environments: { production: { places: { "start-place": { placeId: "4711" } } } },
				passes: {
					"vip-pass": {
						name: "VIP Pass",
						description: "Grants VIP perks.",
						icon: { "en-us": "assets/vip-icon.png" },
						price: 500,
					},
				},
				places: { "start-place": { filePath: "places/start.rbxl" } },
				universe: { universeId: "1" },
			},
			credential,
			environment: "production",
			getEnv: environmentFrom({}),
			readFile: readBytesAsync,
			statePort: statePortWith(universeOnlyState()),
		});

		assert(!result.success);

		expect(result.err).toStrictEqual({ kind: "credentialNotSupported", places: [startPlace] });
		expect(calls).toStrictEqual([]);
		expect(builds).toStrictEqual([]);
		expect(codegen.writes).toStrictEqual([]);
	});

	it("should fail an OAuth publish of an owed place", async ({ expect }) => {
		expect.assertions(2);

		const { calls, credential } = oauthCredential();

		const result = await publish({
			config: placeConfig(),
			credential,
			environment: "production",
			getEnv: environmentFrom({}),
			readFile: readBytesAsync,
			statePort: statePortWith(universeOnlyState({ pendingRebuild: new Set([startPlace]) })),
		});

		assert(!result.success);

		expect(result.err).toStrictEqual({ kind: "credentialNotSupported", places: [startPlace] });
		expect(calls).toStrictEqual([]);
	});
});
