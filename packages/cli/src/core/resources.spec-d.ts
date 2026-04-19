import { describe, expectTypeOf, it } from "vitest";

import type { GamePassDesiredState, ResourceDesiredState } from "./resources.ts";

describe("ResourceDesiredState", () => {
	it("should narrow to GamePassDesiredState when kind is gamePass", () => {
		expectTypeOf<
			Extract<ResourceDesiredState, { kind: "gamePass" }>
		>().toEqualTypeOf<GamePassDesiredState>();
	});
});
