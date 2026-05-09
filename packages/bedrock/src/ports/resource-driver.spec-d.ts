import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";

import { describe, expectTypeOf, it } from "vitest";

import type { GamePassDesiredState, ResourceCurrentState } from "../core/resources.ts";
import type { DriverRegistry, ResourceDriver } from "./resource-driver.ts";

describe("ResourceDriver", () => {
	it("should accept the matching desired state for its kind", () => {
		expectTypeOf<
			Parameters<ResourceDriver<"gamePass">["create"]>[0]
		>().toEqualTypeOf<GamePassDesiredState>();
	});

	it("should return a Promise<Result<current-for-kind, OpenCloudError>>", () => {
		expectTypeOf<ReturnType<ResourceDriver<"gamePass">["create"]>>().toEqualTypeOf<
			Promise<Result<Extract<ResourceCurrentState, { kind: "gamePass" }>, OpenCloudError>>
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
