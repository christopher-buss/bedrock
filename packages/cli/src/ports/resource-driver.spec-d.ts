import type { OpenCloudError, Result } from "@bedrock/ocale";

import { describe, expectTypeOf, it } from "vitest";

import type { GamePassDesiredState, ResourceCurrentState } from "../core/resources.ts";
import type { DriverRegistry, ResourceDriver } from "./resource-driver.ts";

describe("ResourceDriver", () => {
	it("should accept the matching desired state for its kind", () => {
		expectTypeOf<
			Parameters<ResourceDriver<"gamePass">["create"]>[0]
		>().toEqualTypeOf<GamePassDesiredState>();
	});

	it("should return a Promise<Result<current, OpenCloudError>> for its kind", () => {
		expectTypeOf<ReturnType<ResourceDriver<"gamePass">["create"]>>().toEqualTypeOf<
			Promise<Result<ResourceCurrentState, OpenCloudError>>
		>();
	});
});

describe("DriverRegistry", () => {
	it("should bind each kind to its matching ResourceDriver", () => {
		expectTypeOf<DriverRegistry["gamePass"]>().toEqualTypeOf<ResourceDriver<"gamePass">>();
	});

	it("should reject a registry missing a required kind at compile time", () => {
		// @ts-expect-error an empty object is missing the required `gamePass`
		// entry.
		const registry: DriverRegistry = {};
		expectTypeOf(registry).toEqualTypeOf<DriverRegistry>();
	});
});
