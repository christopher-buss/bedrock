import { describe, expect, it } from "vitest";

import { defaultKindRegistry } from "./index.ts";
import type { KindRegistry } from "./module.ts";

describe("defaultKindRegistry", () => {
	it("should key every entry by the kind discriminator its module declares", () => {
		expect.assertions(1);

		const mismatches = (
			Object.entries(defaultKindRegistry) as Array<
				[keyof KindRegistry, KindRegistry[keyof KindRegistry]]
			>
		)
			.filter(([slot, module]) => slot !== module.kind)
			.map(([slot]) => slot);

		expect(mismatches).toBeEmpty();
	});

	it("should cover every ResourceKind (developerProduct, gamePass, place, universe)", () => {
		expect.assertions(1);

		expect(Object.keys(defaultKindRegistry).toSorted()).toStrictEqual([
			"developerProduct",
			"gamePass",
			"place",
			"universe",
		]);
	});
});
