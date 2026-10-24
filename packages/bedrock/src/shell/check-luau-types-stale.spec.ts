import { describe, it } from "vitest";

import { checkLuauTypesStaleAsync } from "./check-luau-types-stale.ts";

const TYPES = "/project/.bedrock/config.luau";

async function check(onDisk: string | undefined): ReturnType<typeof checkLuauTypesStaleAsync> {
	return checkLuauTypesStaleAsync({
		bundledSource: "return {}\n",
		projectRoot: "/project",
		readOptionalTextFile: async (path) => (path === TYPES ? onDisk : undefined),
	});
}

describe(checkLuauTypesStaleAsync, () => {
	it("should report types matching the shipped source as fresh", async ({ expect }) => {
		expect.assertions(1);

		await expect(check("return {}\n")).resolves.toStrictEqual({
			status: "fresh",
			typesPath: TYPES,
		});
	});

	it("should report types differing from the shipped source by any byte as stale", async ({
		expect,
	}) => {
		expect.assertions(1);

		await expect(check("return {}\n\n")).resolves.toStrictEqual({
			status: "stale",
			typesPath: TYPES,
		});
	});

	it("should report absent types as missing", async ({ expect }) => {
		expect.assertions(1);

		await expect(check(undefined)).resolves.toStrictEqual({
			status: "missing",
			typesPath: TYPES,
		});
	});
});
