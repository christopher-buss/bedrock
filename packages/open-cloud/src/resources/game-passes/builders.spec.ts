import { describe, expect, it } from "vitest";

import { buildGetRequest } from "./builders.ts";
import type { GetGamePassParameters } from "./types.ts";

describe(buildGetRequest, () => {
	it("should use the GET method", () => {
		expect.assertions(1);

		const params = {
			gamePassId: "12345",
			universeId: "67890",
		} satisfies GetGamePassParameters;

		const request = buildGetRequest(params);

		expect(request.method).toBe("GET");
	});

	it("should interpolate universeId and gamePassId into the creator URL", () => {
		expect.assertions(1);

		const params = {
			gamePassId: "12345",
			universeId: "67890",
		} satisfies GetGamePassParameters;

		const request = buildGetRequest(params);

		expect(request.url).toBe(
			"/game-passes/v1/universes/67890/game-passes/12345/creator",
		);
	});
});
