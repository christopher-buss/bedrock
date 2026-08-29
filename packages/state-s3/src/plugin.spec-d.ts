import { describe, expectTypeOf, it } from "vitest";

import { s3StateBackend } from "./plugin.ts";

describe("s3StateBackend", () => {
	it("should claim the backend name as a literal a config can key on", () => {
		expectTypeOf(s3StateBackend.name).toEqualTypeOf<"s3">();
	});
});
