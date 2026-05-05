import { describe, expectTypeOf, it } from "vitest";

import type { OpenCloudError } from "../../errors/base.ts";
import type { Result } from "../../types.ts";
import type { GamePass, GamePassesClient, UpdateGamePassParameters } from "./index.ts";

describe("UpdateGamePassParameters", () => {
	it("should require gamePassId and universeId", () => {
		expectTypeOf<UpdateGamePassParameters>().toExtend<{
			gamePassId: string;
			universeId: string;
		}>();
	});

	it("should accept identifiers without any optional fields", () => {
		const parameters: UpdateGamePassParameters = {
			gamePassId: "12345",
			universeId: "67890",
		};

		expectTypeOf(parameters).toExtend<UpdateGamePassParameters>();
	});

	it("should accept every wire field as optional", () => {
		const parameters: UpdateGamePassParameters = {
			name: "Epic Pass",
			description: "Unlocks epic stuff",
			gamePassId: "12345",
			isForSale: true,
			isRegionalPricingEnabled: false,
			price: 100,
			universeId: "67890",
		};

		expectTypeOf(parameters).toExtend<UpdateGamePassParameters>();
	});
});

describe("GamePass", () => {
	it("should have an id and a name", () => {
		expectTypeOf<GamePass>().toExtend<{ id: string; name: string }>();
	});
});

describe("GamePassesClient", () => {
	it("should resolve update() to Result<undefined, OpenCloudError>", () => {
		expectTypeOf<GamePassesClient["update"]>().returns.resolves.toEqualTypeOf<
			Result<undefined, OpenCloudError>
		>();
	});
});
