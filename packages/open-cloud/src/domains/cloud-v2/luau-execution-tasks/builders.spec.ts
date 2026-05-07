import { describe, expect, it } from "vitest";

import { buildSubmitAtHeadRequest } from "./builders.ts";

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
