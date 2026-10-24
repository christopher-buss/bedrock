import { describe, it } from "vitest";

import { checkLuauTypesStaleAsync } from "./check-luau-types-stale.ts";

const TYPES = "/project/.bedrock/config.luau";

function readsOnly(
	target: string,
	contents: string | undefined,
): (path: string) => Promise<string | undefined> {
	return async (path) => (path === target ? contents : undefined);
}

async function check(onDisk: string | undefined): ReturnType<typeof checkLuauTypesStaleAsync> {
	return checkLuauTypesStaleAsync({
		bundledSource: "return {}\n",
		projectRoot: "/project",
		readOptionalTextFile: readsOnly(TYPES, onDisk),
		typesFile: ".bedrock/config.luau",
	});
}

describe(checkLuauTypesStaleAsync, () => {
	it("should report types matching the shipped source as fresh", async ({ expect }) => {
		expect.assertions(1);

		await expect(check("return {}\n")).resolves.toStrictEqual({
			data: { status: "fresh", typesPath: TYPES },
			success: true,
		});
	});

	it("should report types differing from the shipped source by any byte as stale", async ({
		expect,
	}) => {
		expect.assertions(1);

		await expect(check("return {}\n\n")).resolves.toStrictEqual({
			data: { status: "stale", typesPath: TYPES },
			success: true,
		});
	});

	it("should report absent types as missing", async ({ expect }) => {
		expect.assertions(1);

		await expect(check(undefined)).resolves.toStrictEqual({
			data: { status: "missing", typesPath: TYPES },
			success: true,
		});
	});

	it("should read the types file at the given path under the project root", async ({
		expect,
	}) => {
		expect.assertions(1);

		await expect(
			checkLuauTypesStaleAsync({
				bundledSource: "return {}\n",
				projectRoot: "/project",
				readOptionalTextFile: readsOnly("/project/types/bedrock.luau", "return {}\n"),
				typesFile: "types/bedrock.luau",
			}),
		).resolves.toStrictEqual({
			data: { status: "fresh", typesPath: "/project/types/bedrock.luau" },
			success: true,
		});
	});

	it("should report a types file it could not read as a read failure", async ({ expect }) => {
		expect.assertions(1);

		const cause = new Error("EACCES: permission denied");

		await expect(
			checkLuauTypesStaleAsync({
				bundledSource: "return {}\n",
				projectRoot: "/project",
				readOptionalTextFile: async () => {
					throw cause;
				},
				typesFile: ".bedrock/config.luau",
			}),
		).resolves.toStrictEqual({
			err: { cause, kind: "fileReadFailed", path: TYPES },
			success: false,
		});
	});
});
