import { assert, describe, expect, it } from "vitest";

import { ValidationError } from "../../../errors/validation.ts";
import {
	buildGetRequest,
	buildSubmitAtHeadRequest,
	buildSubmitAtVersionRequest,
} from "./builders.ts";
import type { LuauExecutionTaskRef } from "./types.ts";

describe(buildSubmitAtHeadRequest, () => {
	it("should produce a POST request targeting /cloud/v2/universes/{uid}/places/{pid}/luau-execution-session-tasks", () => {
		expect.assertions(2);

		const request = buildSubmitAtHeadRequest({
			placeId: "456",
			script: "return 1",
			universeId: "123",
		});

		expect(request.method).toBe("POST");
		expect(request.url).toBe("/cloud/v2/universes/123/places/456/luau-execution-session-tasks");
	});

	it("should send the script in a JSON body with content-type application/json", () => {
		expect.assertions(2);

		const request = buildSubmitAtHeadRequest({
			placeId: "456",
			script: "return 1",
			universeId: "123",
		});

		expect(request.body).toStrictEqual({ script: "return 1" });
		expect(request.headers).toStrictEqual({ "content-type": "application/json" });
	});

	it("should serialize timeoutSeconds to a duration string in the body", () => {
		expect.assertions(1);

		const request = buildSubmitAtHeadRequest({
			placeId: "456",
			script: "return 1",
			timeoutSeconds: 300,
			universeId: "123",
		});

		expect(request.body).toStrictEqual({ script: "return 1", timeout: "300s" });
	});
});

describe("binaryInput serialization", () => {
	it.for([buildSubmitAtHeadRequest, buildSubmitAtVersionRequest] as const)(
		"should serialize binaryInput onto the submit body when supplied",
		(buildFunc) => {
			expect.assertions(1);

			const request = buildFunc({
				binaryInput: "universes/123/luau-execution-session-task-binary-inputs/abc",
				placeId: "456",
				script: "return 1",
				universeId: "123",
				versionId: "789",
			});

			expect(request.body).toStrictEqual({
				binaryInput: "universes/123/luau-execution-session-task-binary-inputs/abc",
				script: "return 1",
			});
		},
	);
});

describe(buildSubmitAtVersionRequest, () => {
	it("should produce a POST request targeting /cloud/v2/universes/{uid}/places/{pid}/versions/{vid}/luau-execution-session-tasks", () => {
		expect.assertions(2);

		const request = buildSubmitAtVersionRequest({
			placeId: "456",
			script: "return 1",
			universeId: "123",
			versionId: "789",
		});

		expect(request.method).toBe("POST");
		expect(request.url).toBe(
			"/cloud/v2/universes/123/places/456/versions/789/luau-execution-session-tasks",
		);
	});

	it("should send the same JSON body and content-type header as the head-version variant", () => {
		expect.assertions(2);

		const request = buildSubmitAtVersionRequest({
			placeId: "456",
			script: "return 1",
			timeoutSeconds: 300,
			universeId: "123",
			versionId: "789",
		});

		expect(request.body).toStrictEqual({ script: "return 1", timeout: "300s" });
		expect(request.headers).toStrictEqual({ "content-type": "application/json" });
	});
});

const FULL_REF: LuauExecutionTaskRef = Object.freeze({
	placeId: "456",
	sessionId: "session-1",
	taskId: "task-1",
	universeId: "123",
	versionId: "789",
});

describe(buildGetRequest, () => {
	it("should produce a GET request for the maximal /versions/.../sessions/.../tasks/{id} URL without a view query when view is undefined", () => {
		expect.assertions(3);

		const result = buildGetRequest({ ref: FULL_REF });

		assert(result.success);

		expect(result.data.method).toBe("GET");
		expect(result.data.url).toBe(
			"/cloud/v2/universes/123/places/456/versions/789/luau-execution-sessions/session-1/tasks/task-1",
		);
		expect(result.data.url).not.toContain("view=");
	});

	it.for(["BASIC", "FULL"] as const)("should append ?view=%s when view is set", (view) => {
		expect.assertions(1);

		const result = buildGetRequest({ ref: FULL_REF, view });

		assert(result.success);

		expect(result.data.url).toEndWith(`?view=${view}`);
	});

	it.for([
		["versionId", { ...FULL_REF, versionId: undefined }],
		["sessionId", { ...FULL_REF, sessionId: undefined }],
	] as const)(
		"should return ValidationError incomplete_ref naming the missing %s field",
		([field, ref]) => {
			expect.assertions(3);

			const result = buildGetRequest({ ref });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ValidationError);
			expect(result.err.code).toBe("incomplete_ref");
			expect(result.err.message).toContain(field);
		},
	);
});
