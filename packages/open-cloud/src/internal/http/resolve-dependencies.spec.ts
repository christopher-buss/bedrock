import { resolveDependencies } from "#src/internal/http/resolve-dependencies";
import { createFakeHttpClient } from "#tests/helpers/fake-http-client";
import { setTimeout } from "node:timers/promises";
import { describe, expect, it } from "vitest";

describe(resolveDependencies, () => {
	it("should use the provided httpClient when supplied", () => {
		expect.assertions(1);

		const httpClient = createFakeHttpClient({ schemaValidation: "off" });

		const resolved = resolveDependencies({ httpClient });

		expect(resolved.httpClient).toBe(httpClient);
	});

	it("should create a fetch-backed httpClient when omitted", () => {
		expect.assertions(1);

		const resolved = resolveDependencies({});

		expect(resolved.httpClient).toBeObject();
	});

	it("should use the provided sleep when supplied", () => {
		expect.assertions(1);

		async function customSleep(_ms: number): Promise<void> {}

		const resolved = resolveDependencies({ sleep: customSleep });

		expect(resolved.sleep).toBe(customSleep);
	});

	it("should fall back to the default sleep when omitted", () => {
		expect.assertions(1);

		const resolved = resolveDependencies({});

		expect(resolved.sleep).toBe(setTimeout);
	});
});
