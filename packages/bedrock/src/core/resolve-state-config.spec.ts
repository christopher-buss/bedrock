import { assert, describe, expect, it } from "vitest";

import { resolveStateConfig } from "./resolve-state-config.ts";
import type { Config, StateConfig } from "./schema.ts";

const ROOT_STATE: StateConfig = { backend: "gist", gistId: "root-gist" };
const PROD_STATE: StateConfig = { backend: "gist", gistId: "prod-gist" };

describe(resolveStateConfig, () => {
	it("should return the root state when no per-environment override exists", () => {
		expect.assertions(1);

		const config: Config = {
			environments: { production: {} },
			state: ROOT_STATE,
		};

		const result = resolveStateConfig(config, "production");

		assert(result.success);

		expect(result.data).toBe(ROOT_STATE);
	});

	it("should return the per-environment state when both root and override are set", () => {
		expect.assertions(1);

		const config: Config = {
			environments: { production: { state: PROD_STATE } },
			state: ROOT_STATE,
		};

		const result = resolveStateConfig(config, "production");

		assert(result.success);

		expect(result.data).toBe(PROD_STATE);
	});

	it("should return the per-environment state when only the override is set", () => {
		expect.assertions(1);

		const config: Config = {
			environments: { production: { state: PROD_STATE } },
		};

		const result = resolveStateConfig(config, "production");

		assert(result.success);

		expect(result.data).toBe(PROD_STATE);
	});

	it("should return the root state when the environment exists but lacks an override", () => {
		expect.assertions(1);

		const config: Config = {
			environments: { production: {} },
			state: ROOT_STATE,
		};

		const result = resolveStateConfig(config, "production");

		assert(result.success);

		expect(result.data).toBe(ROOT_STATE);
	});

	it("should return the root state when the environment is not declared in environments", () => {
		expect.assertions(1);

		const config: Config = {
			environments: { staging: { state: PROD_STATE } },
			state: ROOT_STATE,
		};

		const result = resolveStateConfig(config, "production");

		assert(result.success);

		expect(result.data).toBe(ROOT_STATE);
	});

	it("should return Err(stateNotConfigured) when neither root nor environment provides state", () => {
		expect.assertions(2);

		const config: Config = { environments: { production: {} } };

		const result = resolveStateConfig(config, "production");

		assert(!result.success);

		expect(result.err.kind).toBe("stateNotConfigured");
		expect(result.err.environment).toBe("production");
	});
});
