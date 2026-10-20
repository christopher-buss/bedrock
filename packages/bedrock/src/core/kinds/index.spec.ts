import { describe, it } from "vitest";

import type { ResourceKind } from "../resources.ts";
import { defaultKindRegistry } from "./index.ts";

const KINDS = [
	"developerProduct",
	"gamePass",
	"place",
	"universe",
] as const satisfies ReadonlyArray<ResourceKind>;

describe("defaultKindRegistry", () => {
	it.for(KINDS)(
		"should key the %s slot by the kind discriminator its module declares",
		(kind, { expect }) => {
			expect.assertions(1);

			expect(defaultKindRegistry[kind].kind).toBe(kind);
		},
	);

	it("should cover every ResourceKind (developerProduct, gamePass, place, universe)", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(Object.keys(defaultKindRegistry).toSorted()).toStrictEqual([...KINDS]);
	});
});
