import { describe, expect, it } from "vitest";

import { buildCreateBinaryInputRequest } from "./builders.ts";

describe(buildCreateBinaryInputRequest, () => {
	it("should produce a POST request targeting /cloud/v2/universes/{uid}/luau-execution-session-task-binary-inputs with a JSON body carrying size", () => {
		expect.assertions(4);

		const request = buildCreateBinaryInputRequest({ size: 1024, universeId: "123" });

		expect(request.method).toBe("POST");
		expect(request.url).toBe(
			"/cloud/v2/universes/123/luau-execution-session-task-binary-inputs",
		);
		expect(request.body).toStrictEqual({ size: 1024 });
		expect(request.headers).toStrictEqual({ "content-type": "application/json" });
	});
});
