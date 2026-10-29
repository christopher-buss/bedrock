import { describe, it } from "vitest";

import { isolateEnvironment } from "./isolated-environment.ts";

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
