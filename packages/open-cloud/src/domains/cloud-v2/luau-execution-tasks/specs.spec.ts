import { describe, expect, it } from "vitest";

import {
	GET_OPERATION_LIMIT,
	GET_REQUIRED_SCOPES,
	SUBMIT_OPERATION_LIMIT,
	SUBMIT_REQUIRED_SCOPES,
} from "./operations.ts";
import { parseLuauExecutionTaskResponse } from "./parsers.ts";
import { GET_SPEC, SUBMIT_HEAD_SPEC, SUBMIT_VERSION_SPEC } from "./specs.ts";

describe("submit-head spec", () => {
	it("should be a create-kind spec wired to the submit limit, write scope, and shared parser", () => {
		expect.assertions(4);

		expect(SUBMIT_HEAD_SPEC.methodKind).toBe("create");
		expect(SUBMIT_HEAD_SPEC.operationLimit).toBe(SUBMIT_OPERATION_LIMIT);
		expect(SUBMIT_HEAD_SPEC.requiredScopes).toBe(SUBMIT_REQUIRED_SCOPES);
		expect(SUBMIT_HEAD_SPEC.parse).toBe(parseLuauExecutionTaskResponse);
	});
});

describe("submit-version spec", () => {
	it("should be a create-kind spec sharing the submit limit and write scope with SUBMIT_HEAD_SPEC", () => {
		expect.assertions(4);

		expect(SUBMIT_VERSION_SPEC.methodKind).toBe("create");
		expect(SUBMIT_VERSION_SPEC.operationLimit).toBe(SUBMIT_OPERATION_LIMIT);
		expect(SUBMIT_VERSION_SPEC.requiredScopes).toBe(SUBMIT_REQUIRED_SCOPES);
		expect(SUBMIT_VERSION_SPEC.parse).toBe(parseLuauExecutionTaskResponse);
	});
});

describe("get spec", () => {
	it("should be an idempotent-kind spec wired to the get limit, read scope, and shared parser", () => {
		expect.assertions(4);

		expect(GET_SPEC.methodKind).toBe("idempotent");
		expect(GET_SPEC.operationLimit).toBe(GET_OPERATION_LIMIT);
		expect(GET_SPEC.requiredScopes).toBe(GET_REQUIRED_SCOPES);
		expect(GET_SPEC.parse).toBe(parseLuauExecutionTaskResponse);
	});
});
