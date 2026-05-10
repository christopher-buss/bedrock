import { assert, describe, expect, it } from "vitest";

import { ValidationError } from "../../../errors/validation.ts";
import { buildListLogsRequest } from "./builders.ts";
import type { LuauExecutionTaskRef } from "./types.ts";

const FULL_REF: LuauExecutionTaskRef = Object.freeze({
	placeId: "456",
	sessionId: "session-1",
	taskId: "task-1",
	universeId: "123",
	versionId: "789",
});

describe(buildListLogsRequest, () => {
	it("should produce a GET request for the maximal /versions/.../sessions/.../tasks/{id}/logs URL with view=STRUCTURED when no page params are supplied", () => {
		expect.assertions(3);

		const result = buildListLogsRequest({ ref: FULL_REF });

		assert(result.success);

		expect(result.data.method).toBe("GET");
		expect(result.data.url).toBe(
			"/cloud/v2/universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1/logs?view=STRUCTURED",
		);
		expect(result.data.url).toContain("view=STRUCTURED");
	});

	it.for([
		["versionId", { ...FULL_REF, versionId: undefined }],
		["sessionId", { ...FULL_REF, sessionId: undefined }],
	] as const)(
		"should return ValidationError incomplete_ref naming the missing %s field",
		([field, ref]) => {
			expect.assertions(3);

			const result = buildListLogsRequest({ ref });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ValidationError);
			expect(result.err.code).toBe("incomplete_ref");
			expect(result.err.message).toContain(field);
		},
	);

	it("should serialize pageSize as the wire's maxPageSize query parameter", () => {
		expect.assertions(1);

		const result = buildListLogsRequest({ pageSize: 100, ref: FULL_REF });

		assert(result.success);

		expect(result.data.url).toContain("maxPageSize=100");
	});

	it("should serialize pageToken verbatim as the pageToken query parameter", () => {
		expect.assertions(1);

		const result = buildListLogsRequest({ pageToken: "tok", ref: FULL_REF });

		assert(result.success);

		expect(result.data.url).toContain("pageToken=tok");
	});

	it("should omit pageSize and pageToken from the URL when neither is supplied", () => {
		expect.assertions(2);

		const result = buildListLogsRequest({ ref: FULL_REF });

		assert(result.success);

		expect(result.data.url).not.toContain("maxPageSize");
		expect(result.data.url).not.toContain("pageToken");
	});

	it("should include both pageSize and pageToken when both are supplied", () => {
		expect.assertions(2);

		const result = buildListLogsRequest({ pageSize: 50, pageToken: "tok", ref: FULL_REF });

		assert(result.success);

		expect(result.data.url).toContain("maxPageSize=50");
		expect(result.data.url).toContain("pageToken=tok");
	});
});
