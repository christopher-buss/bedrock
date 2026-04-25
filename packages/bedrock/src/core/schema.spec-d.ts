import { describe, expectTypeOf, it } from "vitest";

import type { Config, StateConfig } from "./schema.ts";

const STATE: StateConfig = { backend: "gist", gistId: "test" };

describe("Config", () => {
	it("should require environments to be a Record of EnvironmentEntry rather than optional", () => {
		expectTypeOf<Config["environments"]>().not.toBeUndefined();
	});

	it("should reject Config that omits the required environments field", () => {
		// @ts-expect-error environments is required and must be present.
		const config: Config = { state: STATE };
		expectTypeOf(config).toExtend<Config>();
	});

	it("should accept Config with root state plus environments without state on each entry", () => {
		const config = {
			environments: { production: {} },
			state: STATE,
		} as const satisfies Config;
		expectTypeOf(config).toExtend<Config>();
	});

	it("should accept Config with no root state when every environment entry carries its own state", () => {
		const config = {
			environments: {
				production: { state: STATE },
				staging: { state: STATE },
			},
		} as const satisfies Config;
		expectTypeOf(config).toExtend<Config>();
	});

	it("should narrow state on Config to StateConfig | undefined so the deploy boundary handles the missing case", () => {
		expectTypeOf<Config["state"]>().toEqualTypeOf<StateConfig | undefined>();
	});
});
