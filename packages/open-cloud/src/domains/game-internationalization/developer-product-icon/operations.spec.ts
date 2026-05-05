import { describe, expect, it } from "vitest";

import { LOCALIZATION_OPERATION_LIMIT, LOCALIZATION_REQUIRED_SCOPES } from "./operations.ts";

describe("developer-product icon operation limit", () => {
	it("should cap the service at 100 requests per minute under the shared localization key", () => {
		expect.assertions(1);

		expect(LOCALIZATION_OPERATION_LIMIT).toStrictEqual({
			maxPerSecond: 100 / 60,
			operationKey: "developer-product-localization",
		});
	});

	it("should freeze the operation limit so callers cannot mutate the registry", () => {
		expect.assertions(1);

		expect(Object.isFrozen(LOCALIZATION_OPERATION_LIMIT)).toBeTrue();
	});
});

describe("developer-product icon required scopes", () => {
	it("should require legacy-developer-product:manage", () => {
		expect.assertions(1);

		expect(LOCALIZATION_REQUIRED_SCOPES).toStrictEqual(["legacy-developer-product:manage"]);
	});

	it("should freeze the required-scopes list so callers cannot mutate it", () => {
		expect.assertions(1);

		expect(Object.isFrozen(LOCALIZATION_REQUIRED_SCOPES)).toBeTrue();
	});
});
