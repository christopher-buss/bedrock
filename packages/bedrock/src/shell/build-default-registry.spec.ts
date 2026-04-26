import { assert, describe, expect, it } from "vitest";

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

function environmentFrom(values: Record<string, string>): (name: string) => string | undefined {
	return (name) => values[name];
}

async function neverReadFile(): Promise<Uint8Array> {
	return new Uint8Array();
}

describe(buildDefaultRegistry, () => {
	it("should construct gamePass, place, and universe drivers when ROBLOX_API_KEY and config.universe.universeId are present", () => {
		expect.assertions(3);

		const result = buildDefaultRegistry({
			config: configWithUniverse(),
			getEnv: environmentFrom({ ROBLOX_API_KEY: "rbx-test" }),
			readFile: neverReadFile,
		});

		assert(result.success);

		expect(result.data.gamePass).toBeObject();
		expect(result.data.place).toBeObject();
		expect(result.data.universe).toBeObject();
	});

	it("should return Err(missingCredential) when ROBLOX_API_KEY is unset", () => {
		expect.assertions(3);

		const result = buildDefaultRegistry({
			config: configWithUniverse(),
			getEnv: environmentFrom({}),
			readFile: neverReadFile,
		});

		assert(!result.success);
		assert(result.err.kind === "missingCredential");

		expect(result.err.kind).toBe("missingCredential");
		expect(result.err.variable).toBe("ROBLOX_API_KEY");
		expect(result.err.purpose).toBe("registry");
	});

	it("should return Err(registryConfigMissing) with missing 'universeId' when config.universe is absent", () => {
		expect.assertions(3);

		const result = buildDefaultRegistry({
			config: { environments: { production: {} }, state: STATE_CONFIG },
			getEnv: environmentFrom({ ROBLOX_API_KEY: "rbx-test" }),
			readFile: neverReadFile,
		});

		assert(!result.success);
		assert(result.err.kind === "registryConfigMissing");

		expect(result.err.missing).toBe("universeId");
		expect(result.err.hint).toContain("universe.universeId");
		expect(result.err.kind).toBe("registryConfigMissing");
	});

	it("should not invoke getEnv beyond ROBLOX_API_KEY on the happy path", () => {
		expect.assertions(2);

		const reads: Array<string> = [];
		const result = buildDefaultRegistry({
			config: configWithUniverse(),
			getEnv: (name) => {
				reads.push(name);
				return name === "ROBLOX_API_KEY" ? "rbx-test" : undefined;
			},
			readFile: neverReadFile,
		});

		assert(result.success);

		expect(reads).toStrictEqual(["ROBLOX_API_KEY"]);
		expect(result.data).toBeObject();
	});
});
