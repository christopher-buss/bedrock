import { describe, expectTypeOf, it } from "vitest";

import type { CreateGamePassParameters } from "#src/domains/game-passes/game-passes/types";
import { listDeprecatedMultipartFields, listMultipartProperties } from "./_helpers.ts";

const CREATE_GAME_PASS_KEYS = [
	"description",
	"imageFile",
	"isForSale",
	"isManagedPricingEnabled",
	"name",
	"price",
] as const;

expectTypeOf<(typeof CREATE_GAME_PASS_KEYS)[number]>().toEqualTypeOf<
	Exclude<keyof CreateGamePassParameters, "universeId">
>();

describe("createGamePassParameters multipart pin", () => {
	it.for(CREATE_GAME_PASS_KEYS)(
		"should expose %s as a declared non-deprecated multipart property on create",
		(key, { expect }) => {
			expect.assertions(2);

			const route = "/game-passes/v1/universes/{universeId}/game-passes";

			expect(listMultipartProperties(route, "post")).toContain(key);
			expect(listDeprecatedMultipartFields(route, "post")).not.toContain(key);
		},
	);
});
