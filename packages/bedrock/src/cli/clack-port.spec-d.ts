import { describe, expectTypeOf, it } from "vitest";

import { createClackPort } from "./clack-port.ts";
import type { ClackPort } from "./render.ts";

describe(createClackPort, () => {
	it("should return a ClackPort and take no arguments", () => {
		expectTypeOf(createClackPort).toEqualTypeOf<() => ClackPort>();
	});
});
