import { describe, expect, it } from "vitest";

import { findOperation } from "./openapi-operations.ts";

describe(findOperation, () => {
	it("should resolve a GET on a concrete game-passes creator url", () => {
		expect.assertions(2);

		const match = findOperation("GET", "/game-passes/v1/universes/42/game-passes/999/creator");

		expect(match?.pathTemplate).toBe(
			"/game-passes/v1/universes/{universeId}/game-passes/{gamePassId}/creator",
		);
		expect(match?.pathParams).toStrictEqual({ gamePassId: "999", universeId: "42" });
	});

	it("should resolve a POST on the game-passes create endpoint", () => {
		expect.assertions(3);

		const match = findOperation("POST", "/game-passes/v1/universes/42/game-passes");

		expect(match?.pathTemplate).toBe("/game-passes/v1/universes/{universeId}/game-passes");
		expect(match?.pathParams).toStrictEqual({ universeId: "42" });
		expect(match?.operation["operationId"]).toBeString();
	});

	it("should accept a lowercase method", () => {
		expect.assertions(1);

		const match = findOperation("get", "/game-passes/v1/universes/42/game-passes/creator");

		expect(match?.pathTemplate).toBe(
			"/game-passes/v1/universes/{universeId}/game-passes/creator",
		);
	});

	it("should strip an absolute url prefix before matching", () => {
		expect.assertions(1);

		const match = findOperation(
			"POST",
			"https://apis.roblox.com/game-passes/v1/universes/42/game-passes",
		);

		expect(match?.pathTemplate).toBe("/game-passes/v1/universes/{universeId}/game-passes");
	});

	it("should strip a query string before matching", () => {
		expect.assertions(1);

		const match = findOperation(
			"POST",
			"/game-passes/v1/universes/42/game-passes?maxPageSize=10",
		);

		expect(match?.pathTemplate).toBe("/game-passes/v1/universes/{universeId}/game-passes");
	});

	it("should return undefined for an unknown url", () => {
		expect.assertions(1);

		expect(findOperation("GET", "/does-not-exist/42")).toBeUndefined();
	});

	it("should return undefined when a known url is queried with the wrong method", () => {
		expect.assertions(1);

		// The create endpoint is POST-only; DELETE should not match.
		expect(findOperation("DELETE", "/game-passes/v1/universes/42/game-passes")).toBeUndefined();
	});

	it("should distinguish :action templates from the parameter-only sibling", () => {
		expect.assertions(2);

		const assignRole = findOperation("POST", "/cloud/v2/groups/42/memberships/abc:assignRole");
		const plain = findOperation("POST", "/cloud/v2/groups/42/memberships/abc");

		expect(assignRole?.pathTemplate).toBe(
			"/cloud/v2/groups/{group_id}/memberships/{membership_id}:assignRole",
		);
		// PATCH exists on the plain path, but POST does not - so a POST
		// should not silently match the parameter-only template and swallow
		// the ":assignRole" suffix as part of the membership id.
		expect(plain).toBeUndefined();
	});

	it("should return the same match reference on repeated lookups (cache hit)", () => {
		expect.assertions(1);

		const first = findOperation("POST", "/game-passes/v1/universes/42/game-passes");
		const second = findOperation("POST", "/game-passes/v1/universes/42/game-passes");

		expect(first).toBe(second);
	});
});
