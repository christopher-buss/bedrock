import { describe, expect, it } from "vitest";

import { GATEWAY_REJECTED, RESPONSE_UNPARSEABLE, TRANSIENT_TRANSPORT_CODES } from "./index.ts";
import {
	TRANSIENT_TRANSPORT_CODES as canonical,
	GATEWAY_REJECTED as canonicalGateway,
	RESPONSE_UNPARSEABLE as canonicalUnparseable,
} from "./internal/http/retry.ts";

describe("root entry", () => {
	it("should re-export the canonical transient transport code set from the root entry", () => {
		expect.assertions(1);

		expect(TRANSIENT_TRANSPORT_CODES).toBe(canonical);
	});

	// The synthetic codes are the only way to name these failures in a
	// per-request `retryableTransportCodes` override, so they have to be
	// reachable from the published entry point rather than by literal.
	it("should re-export the synthetic transport codes from the root entry", () => {
		expect.assertions(2);

		expect(GATEWAY_REJECTED).toBe(canonicalGateway);
		expect(RESPONSE_UNPARSEABLE).toBe(canonicalUnparseable);
	});
});
