import { describe, expect, it } from "vitest";

import { TRANSIENT_TRANSPORT_CODES } from "./index.ts";
import { TRANSIENT_TRANSPORT_CODES as canonical } from "./internal/http/retry.ts";

describe("root entry", () => {
	it("should re-export the canonical transient transport code set from the root entry", () => {
		expect.assertions(1);

		expect(TRANSIENT_TRANSPORT_CODES).toBe(canonical);
	});
});
