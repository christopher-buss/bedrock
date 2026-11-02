import { describe, it } from "vitest";

import { isolateEnvironment, TEST_ENVIRONMENT_ALLOWLIST } from "./isolated-environment.ts";

const ALLOWED = { names: ["PATH", "TEMP"], prefixes: ["VITEST"] };

describe(isolateEnvironment, () => {
	it("should remove a variable the allowlist does not name", ({ expect }) => {
		expect.assertions(1);

		const environment: Record<string, string | undefined> = { BEDROCK_API_KEY: "secret" };
		isolateEnvironment(environment, ALLOWED);

		expect(environment).toStrictEqual({});
	});

	it("should keep a variable the allowlist names", ({ expect }) => {
		expect.assertions(1);

		const environment: Record<string, string | undefined> = { PATH: "/usr/bin", TEMP: "/tmp" };
		isolateEnvironment(environment, ALLOWED);

		expect(environment).toStrictEqual({ PATH: "/usr/bin", TEMP: "/tmp" });
	});

	it("should match allowed names regardless of case", ({ expect }) => {
		expect.assertions(1);

		const environment: Record<string, string | undefined> = { Path: "C:\\Windows" };
		isolateEnvironment(environment, ALLOWED);

		expect(environment).toStrictEqual({ Path: "C:\\Windows" });
	});

	it("should keep a variable that starts with an allowed prefix", ({ expect }) => {
		expect.assertions(1);

		const environment: Record<string, string | undefined> = { VITEST_POOL_ID: "1" };
		isolateEnvironment(environment, ALLOWED);

		expect(environment).toStrictEqual({ VITEST_POOL_ID: "1" });
	});
});

describe("tEST_ENVIRONMENT_ALLOWLIST", () => {
	it("should keep the values Vitest exposes through import.meta.env", ({ expect }) => {
		expect.assertions(1);

		const environment: Record<string, string | undefined> = {
			BASE_URL: "/",
			DEV: "1",
			MODE: "test",
			PROD: "",
			SSR: "1",
		};
		isolateEnvironment(environment, TEST_ENVIRONMENT_ALLOWLIST);

		expect(environment).toStrictEqual({
			BASE_URL: "/",
			DEV: "1",
			MODE: "test",
			PROD: "",
			SSR: "1",
		});
	});

	it("should remove a Bun registry credential", ({ expect }) => {
		expect.assertions(1);

		const environment: Record<string, string | undefined> = {
			BUN_AUTH_TOKEN: "secret",
			BUN_INSTALL: "/home/user/.bun",
		};
		isolateEnvironment(environment, TEST_ENVIRONMENT_ALLOWLIST);

		expect(environment).toStrictEqual({ BUN_INSTALL: "/home/user/.bun" });
	});
});
