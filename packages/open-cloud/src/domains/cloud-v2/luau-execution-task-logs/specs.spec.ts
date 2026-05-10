import { describe, expect, it } from "vitest";

import { LIST_LOGS_OPERATION_LIMIT, LIST_LOGS_REQUIRED_SCOPES } from "./operations.ts";
import { parseListLogsResponse } from "./parsers.ts";
import { LIST_LOGS_SPEC } from "./specs.ts";

describe("list-logs spec", () => {
	it("should be an idempotent-kind spec wired to the list-logs limit, read scope, and shared parser", () => {
		expect.assertions(4);

		expect(LIST_LOGS_SPEC.methodKind).toBe("idempotent");
		expect(LIST_LOGS_SPEC.operationLimit).toBe(LIST_LOGS_OPERATION_LIMIT);
		expect(LIST_LOGS_SPEC.requiredScopes).toBe(LIST_LOGS_REQUIRED_SCOPES);
		expect(LIST_LOGS_SPEC.parse).toBe(parseListLogsResponse);
	});
});
