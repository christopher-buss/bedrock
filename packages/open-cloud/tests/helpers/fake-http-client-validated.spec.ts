import type { HttpRequest, RequestConfig } from "#src/internal/http/types";
import { assert, describe, expect, it } from "vitest";

import { createFakeHttpClient, FakeHttpClientContractError } from "./fake-http-client-validated.ts";
import { validGamePassBody } from "./game-passes.ts";

const config: RequestConfig = { apiKey: "test", baseUrl: "https://apis.roblox.test" };

const gamePassGet: HttpRequest = {
	method: "GET",
	url: "/game-passes/v1/universes/42/game-passes/999/creator",
};

describe("createFakeHttpClient schema validation", () => {
	describe("off", () => {
		it("should accept any body unchanged", async () => {
			expect.assertions(2);

			const fake = createFakeHttpClient({ schemaValidation: "off" }).mockResponse({
				body: { completely: "invalid" },
				status: 200,
			});

			const result = await fake.request(gamePassGet, config);

			assert(result.success);

			expect(result.data.body).toStrictEqual({ completely: "invalid" });
			expect(fake.schemaViolations).toStrictEqual([]);
		});
	});

	describe("strict (default)", () => {
		it("should reject an invalid body when no mode is passed", async () => {
			expect.assertions(1);

			const fake = createFakeHttpClient().mockResponse({
				body: { completely: "invalid" },
				status: 200,
			});

			await expect(fake.request(gamePassGet, config)).rejects.toBeInstanceOf(
				FakeHttpClientContractError,
			);
		});

		it("should throw on a response body that violates the operation schema", async () => {
			expect.assertions(1);

			const fake = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
				body: { completely: "invalid" },
				status: 200,
			});

			await expect(fake.request(gamePassGet, config)).rejects.toBeInstanceOf(
				FakeHttpClientContractError,
			);
		});

		it("should throw on a request body that violates the operation schema", async () => {
			expect.assertions(1);

			const patchUniverse: HttpRequest = {
				body: { displayName: 42 },
				method: "PATCH",
				url: "/cloud/v2/universes/42",
			};
			const fake = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
				body: {},
				status: 200,
			});

			await expect(fake.request(patchUniverse, config)).rejects.toMatchObject({
				violation: { direction: "request" },
			});
		});

		it("should throw on an unknown url with a helpful message", async () => {
			expect.assertions(1);

			const fake = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
				body: {},
				status: 200,
			});

			await expect(
				fake.request({ method: "GET", url: "/does-not-exist/1" }, config),
			).rejects.toThrowWithMessage(
				FakeHttpClientContractError,
				/no operation matches GET \/does-not-exist\/1/,
			);
		});

		it("should pass through a schema-valid response body", async () => {
			expect.assertions(2);

			const fake = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
				body: validGamePassBody(),
				status: 200,
			});

			const result = await fake.request(gamePassGet, config);

			assert(result.success);

			expect(result.data.status).toBe(200);
			expect(fake.schemaViolations).toStrictEqual([]);
		});

		it("should attach the offending violation to the thrown error", async () => {
			expect.assertions(1);

			const fake = createFakeHttpClient({ schemaValidation: "strict" }).mockResponse({
				body: { completely: "invalid" },
				status: 200,
			});

			await expect(fake.request(gamePassGet, config)).rejects.toMatchObject({
				violation: {
					direction: "response",
					pathTemplate:
						"/game-passes/v1/universes/{universeId}/game-passes/{gamePassId}/creator",
				},
			});
		});
	});

	describe("warn", () => {
		it("should record violations without throwing", async () => {
			expect.assertions(2);

			const fake = createFakeHttpClient({ schemaValidation: "warn" }).mockResponse({
				body: { completely: "invalid" },
				status: 200,
			});

			const result = await fake.request(gamePassGet, config);

			assert(result.success);

			expect(fake.schemaViolations).toHaveLength(1);
			expect(fake.schemaViolations[0]?.direction).toBe("response");
		});

		it("should stay silent on a schema-valid response", async () => {
			expect.assertions(1);

			const fake = createFakeHttpClient({ schemaValidation: "warn" }).mockResponse({
				body: validGamePassBody(),
				status: 200,
			});

			await fake.request(gamePassGet, config);

			expect(fake.schemaViolations).toStrictEqual([]);
		});
	});
});
