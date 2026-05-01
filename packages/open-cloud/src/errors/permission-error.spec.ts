import { describe, expect, it } from "vitest";

import { ApiError } from "./api-error.ts";
import { OpenCloudError } from "./base.ts";
import { PermissionError } from "./permission-error.ts";

describe(PermissionError, () => {
	it("should set name to PermissionError", () => {
		expect.assertions(1);

		const error = new PermissionError("forbidden", {
			operationKey: "developer-products.create",
			requiredScopes: ["creator-store-product:write"],
			statusCode: 403,
		});

		expect(error.name).toBe("PermissionError");
	});

	it("should be an instance of ApiError", () => {
		expect.assertions(1);

		const error = new PermissionError("forbidden", {
			operationKey: "developer-products.create",
			requiredScopes: ["creator-store-product:write"],
			statusCode: 403,
		});

		expect(error).toBeInstanceOf(ApiError);
	});

	it("should be an instance of OpenCloudError", () => {
		expect.assertions(1);

		const error = new PermissionError("forbidden", {
			operationKey: "developer-products.create",
			requiredScopes: ["creator-store-product:write"],
			statusCode: 403,
		});

		expect(error).toBeInstanceOf(OpenCloudError);
	});

	it("should store statusCode", () => {
		expect.assertions(1);

		const error = new PermissionError("unauthorized", {
			operationKey: "game-passes.create",
			requiredScopes: ["game-pass:write"],
			statusCode: 401,
		});

		expect(error.statusCode).toBe(401);
	});

	it("should store requiredScopes", () => {
		expect.assertions(1);

		const error = new PermissionError("forbidden", {
			operationKey: "developer-products.create",
			requiredScopes: ["creator-store-product:write"],
			statusCode: 403,
		});

		expect(error.requiredScopes).toStrictEqual(["creator-store-product:write"]);
	});

	it("should store operationKey", () => {
		expect.assertions(1);

		const error = new PermissionError("forbidden", {
			operationKey: "developer-products.create",
			requiredScopes: ["creator-store-product:write"],
			statusCode: 403,
		});

		expect(error.operationKey).toBe("developer-products.create");
	});

	it("should store code when provided", () => {
		expect.assertions(1);

		const error = new PermissionError("forbidden", {
			code: "INSUFFICIENT_SCOPE",
			operationKey: "developer-products.create",
			requiredScopes: ["creator-store-product:write"],
			statusCode: 403,
		});

		expect(error.code).toBe("INSUFFICIENT_SCOPE");
	});

	it("should have undefined code when not provided", () => {
		expect.assertions(1);

		const error = new PermissionError("forbidden", {
			operationKey: "developer-products.create",
			requiredScopes: ["creator-store-product:write"],
			statusCode: 403,
		});

		expect(error.code).toBeUndefined();
	});

	it("should store cause when provided", () => {
		expect.assertions(1);

		const cause = new Error("upstream");
		const error = new PermissionError("forbidden", {
			cause,
			operationKey: "developer-products.create",
			requiredScopes: ["creator-store-product:write"],
			statusCode: 403,
		});

		expect(error.cause).toBe(cause);
	});

	it("should preserve message", () => {
		expect.assertions(1);

		const error = new PermissionError("HTTP 403", {
			operationKey: "developer-products.create",
			requiredScopes: ["creator-store-product:write"],
			statusCode: 403,
		});

		expect(error.message).toBe("HTTP 403");
	});

	it("should support multiple required scopes", () => {
		expect.assertions(1);

		const error = new PermissionError("forbidden", {
			operationKey: "places.publish",
			requiredScopes: ["place:write:content", "universe:write"],
			statusCode: 403,
		});

		expect(error.requiredScopes).toStrictEqual(["place:write:content", "universe:write"]);
	});
});
