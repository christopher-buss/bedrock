import { describe, it } from "vitest";

import { checkLuauTypesStaleAsync } from "./check-luau-types-stale.ts";

const TYPES = "/project/.bedrock/config.luau";
const STATE = "/project/.bedrock/setup-state.json";

function readsOnly(
	target: string,
	contents: string | undefined,
): (path: string) => Promise<string | undefined> {
	return async (path) => (path === target ? contents : undefined);
}

function readsFiles(files: Record<string, string>): (path: string) => Promise<string | undefined> {
	const onDisk = new Map(Object.entries(files));
	return async (path) => onDisk.get(path);
}

async function check(onDisk: string | undefined): ReturnType<typeof checkLuauTypesStaleAsync> {
	return checkLuauTypesStaleAsync({
		bundledSource: "return {}\n",
		projectRoot: "/project",
		readOptionalTextFile: readsOnly(TYPES, onDisk),
	});
}

/**
 * A read seam that rejects with `cause` for one path and finds nothing
 * elsewhere.
 *
 * @param failingPath - The path whose read rejects.
 * @param cause - The rejection value.
 * @returns The read seam.
 * @rejects The given cause when called with the failing path.
 */
function rejectingAt(
	failingPath: string,
	cause: Error,
): (path: string) => Promise<string | undefined> {
	return async (path) => {
		if (path === failingPath) {
			throw cause;
		}
	};
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

	it("should read the types file at the path a prior setup recorded", async ({ expect }) => {
		expect.assertions(1);

		await expect(
			checkLuauTypesStaleAsync({
				bundledSource: "return {}\n",
				projectRoot: "/project",
				readOptionalTextFile: readsFiles({
					"/project/vendor/config.luau": "return {}\n",
					[STATE]: '{"alias":"rock","typesPath":"vendor/config.luau"}',
				}),
			}),
		).resolves.toStrictEqual({
			data: { status: "fresh", typesPath: "/project/vendor/config.luau" },
			success: true,
		});
	});

	it("should report a recorded setup state it cannot read", async ({ expect }) => {
		expect.assertions(1);

		await expect(
			checkLuauTypesStaleAsync({
				bundledSource: "return {}\n",
				projectRoot: "/project",
				readOptionalTextFile: readsFiles({ [STATE]: "{" }),
			}),
		).resolves.toStrictEqual({
			err: { kind: "malformedSetupState", message: "it is not valid JSON" },
			success: false,
		});
	});

	it("should report a recorded types path it cannot use", async ({ expect }) => {
		expect.assertions(1);

		await expect(
			checkLuauTypesStaleAsync({
				bundledSource: "return {}\n",
				projectRoot: "/project",
				readOptionalTextFile: readsFiles({
					[STATE]: '{"alias":"bedrock","typesPath":"/abs/config.luau"}',
				}),
			}),
		).resolves.toStrictEqual({
			err: { kind: "absoluteTypesPath", typesPath: "/abs/config.luau" },
			success: false,
		});
	});

	it.for([STATE, TYPES])(
		"should report %s as a read failure when it cannot be read",
		async (failingPath, { expect }) => {
			expect.assertions(1);

			const cause = new Error("EACCES: permission denied");

			await expect(
				checkLuauTypesStaleAsync({
					bundledSource: "return {}\n",
					projectRoot: "/project",
					readOptionalTextFile: rejectingAt(failingPath, cause),
				}),
			).resolves.toStrictEqual({
				err: { cause, kind: "fileReadFailed", path: failingPath },
				success: false,
			});
		},
	);
});
