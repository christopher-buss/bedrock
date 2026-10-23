import { assert, describe, it, vi } from "vitest";

import { environmentFrom } from "#tests/helpers/environment";
import {
	developerProductDesired,
	gamePassDesired,
	placeDesired,
	universeDesired,
} from "#tests/helpers/resources";
import type { ResolvedConfig } from "../core/schema.ts";
import { buildDefaultRegistry } from "./build-default-registry.ts";

const STATE_CONFIG = { backend: "gist" as const, gistId: "abc123" };

function configWithUniverse(): ResolvedConfig {
	return {
		environments: { production: {} },
		state: STATE_CONFIG,
		universe: { universeId: "1234567890" },
	};
}

const RBXL_SIGNATURE = new Uint8Array([
	0x3c, 0x72, 0x6f, 0x62, 0x6c, 0x6f, 0x78, 0x21, 0x89, 0xff, 0x0d, 0x0a, 0x1a, 0x0a,
]);

async function rbxlReadFileAsync(): Promise<Uint8Array> {
	return RBXL_SIGNATURE;
}

async function neverReadFileAsync(): Promise<Uint8Array> {
	return new Uint8Array();
}

describe(buildDefaultRegistry, () => {
	it("should construct gamePass, place, and universe drivers when BEDROCK_API_KEY and config.universe.universeId are present", ({
		expect,
	}) => {
		expect.assertions(3);

		const result = buildDefaultRegistry({
			config: configWithUniverse(),
			getEnv: environmentFrom({ BEDROCK_API_KEY: "rbx-test" }),
			readFile: neverReadFileAsync,
		});

		assert(result.success);

		expect(result.data.gamePass).toBeObject();
		expect(result.data.place).toBeObject();
		expect(result.data.universe).toBeObject();
	});

	it("should not read BEDROCK_API_KEY when a credential is given", ({ expect }) => {
		expect.assertions(2);

		const readEnvironment = vi.fn<(name: string) => string | undefined>();
		const result = buildDefaultRegistry({
			config: configWithUniverse(),
			credential: { apiKey: "rbx-test", kind: "apiKey" },
			getEnv: readEnvironment,
			readFile: neverReadFileAsync,
		});

		expect(result.success).toBeTrue();
		expect(readEnvironment).not.toHaveBeenCalled();
	});

	it("should return Err(missingCredential) when BEDROCK_API_KEY is unset", ({ expect }) => {
		expect.assertions(3);

		const result = buildDefaultRegistry({
			config: configWithUniverse(),
			getEnv: environmentFrom({}),
			readFile: neverReadFileAsync,
		});

		assert(!result.success);
		assert(result.err.kind === "missingCredential");

		expect(result.err.kind).toBe("missingCredential");
		expect(result.err.variable).toBe("BEDROCK_API_KEY");
		expect(result.err.purpose).toBe("registry");
	});

	it("should return Err(registryConfigMissing) with missing 'universeId' when config.universe is absent", ({
		expect,
	}) => {
		expect.assertions(3);

		const result = buildDefaultRegistry({
			config: { environments: { production: {} }, state: STATE_CONFIG },
			getEnv: environmentFrom({ BEDROCK_API_KEY: "rbx-test" }),
			readFile: neverReadFileAsync,
		});

		assert(!result.success);
		assert(result.err.kind === "registryConfigMissing");

		expect(result.err.missing).toBe("universeId");
		expect(result.err.hint).toContain("universe.universeId");
		expect(result.err.kind).toBe("registryConfigMissing");
	});

	it("should not invoke getEnv beyond BEDROCK_API_KEY on the happy path", ({ expect }) => {
		expect.assertions(2);

		const reads: Array<string> = [];
		const result = buildDefaultRegistry({
			config: configWithUniverse(),
			getEnv: (name) => {
				reads.push(name);
				return environmentFrom({ BEDROCK_API_KEY: "rbx-test" })(name);
			},
			readFile: neverReadFileAsync,
		});

		assert(result.success);

		expect(reads).toStrictEqual(["BEDROCK_API_KEY"]);
		expect(result.data).toBeObject();
	});

	it("should send BEDROCK_API_KEY from every client it builds", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		const sentKeys: Array<null | string> = [];
		vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
			const headers = new Headers(init.headers);
			sentKeys.push(headers.get("x-api-key"));
			return Response.json({ message: "rejected" }, { status: 400 });
		});
		onTestFinished(() => {
			vi.unstubAllGlobals();
		});

		const result = buildDefaultRegistry({
			config: configWithUniverse(),
			getEnv: environmentFrom({ BEDROCK_API_KEY: "rbx-test" }),
			readFile: rbxlReadFileAsync,
		});

		assert(result.success);

		await result.data.developerProduct.create(developerProductDesired());
		await result.data.gamePass.create(gamePassDesired());
		await result.data.place.create(placeDesired());
		await result.data.universe.create(universeDesired());

		expect(sentKeys).toStrictEqual(["rbx-test", "rbx-test", "rbx-test", "rbx-test"]);
	});
});
