import { join } from "node:path";
import process from "node:process";
import { describe, it, vi } from "vitest";

import { captureStreams } from "#tests/helpers/streams";
import type { ProgDeps as ProgDependencies } from "./index.ts";
import { withLuauTypesCheck } from "./luau-types-check.ts";

const TYPES = "/project/.bedrock/config.luau";
const WARNING = `${TYPES} is out of date for this bedrock version; run bedrock setup to refresh it`;

type Action = () => Promise<void>;
type ReadFunc = NonNullable<ProgDependencies["readOptionalTextFile"]>;
type WarnFunc = NonNullable<ProgDependencies["warn"]>;

function makeDependencies(files: Record<string, string>): ProgDependencies {
	const onDisk = new Map(Object.entries(files));
	return {
		luauConfigSource: "return {}\n",
		projectRoot: "/project",
		readOptionalTextFile: async (path) => onDisk.get(path),
		warn: vi.fn<WarnFunc>(),
	};
}

describe(withLuauTypesCheck, () => {
	it("should warn about stale types and then run the command with its arguments", async ({
		expect,
	}) => {
		expect.assertions(3);

		const dependencies = makeDependencies({ [TYPES]: "return { old = true }\n" });
		const action = vi.fn<(name: string, options: object) => Promise<void>>(async () => {});

		await withLuauTypesCheck(dependencies, action)("x", { env: "production" });

		expect(dependencies.warn).toHaveBeenCalledExactlyOnceWith(WARNING);
		expect(action).toHaveBeenCalledExactlyOnceWith("x", { env: "production" });
		expect(dependencies.warn).toHaveBeenCalledBefore(action);
	});

	it.for([
		["fresh", { [TYPES]: "return {}\n" }],
		["missing", {}],
	] as const)("should stay silent when the types are %s", async ([, files], { expect }) => {
		expect.assertions(2);

		const dependencies = makeDependencies(files);
		const action = vi.fn<Action>(async () => {});

		await withLuauTypesCheck(dependencies, action)();

		expect(dependencies.warn).not.toHaveBeenCalled();
		expect(action).toHaveBeenCalledExactlyOnceWith();
	});

	it("should skip the check when BEDROCK_SKIP_TYPES_CHECK is 1", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(2);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_SKIP_TYPES_CHECK", "1");
		const read = vi.fn<ReadFunc>(async () => "stale");
		const action = vi.fn<Action>(async () => {});

		await withLuauTypesCheck({ ...makeDependencies({}), readOptionalTextFile: read }, action)();

		expect(read).not.toHaveBeenCalled();
		expect(action).toHaveBeenCalledExactlyOnceWith();
	});

	it("should still check when BEDROCK_SKIP_TYPES_CHECK is set to something other than 1", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		vi.stubEnv("BEDROCK_SKIP_TYPES_CHECK", "0");
		const dependencies = makeDependencies({ [TYPES]: "stale" });

		await withLuauTypesCheck(dependencies, async () => {})();

		expect(dependencies.warn).toHaveBeenCalledExactlyOnceWith(WARNING);
	});

	it("should run the command silently when the types cannot be read", async ({ expect }) => {
		expect.assertions(2);

		const dependencies = {
			...makeDependencies({}),
			readOptionalTextFile: async () => {
				throw new Error("EACCES");
			},
		};
		const action = vi.fn<Action>(async () => {});

		await withLuauTypesCheck(dependencies, action)();

		expect(dependencies.warn).not.toHaveBeenCalled();
		expect(action).toHaveBeenCalledExactlyOnceWith();
	});

	it("should warn on stderr by default", async ({ expect }) => {
		expect.assertions(1);

		const { stderr } = captureStreams();
		const typesPath = join(process.cwd(), ".bedrock", "config.luau");
		const onDisk = new Map([[typesPath, "stale"]]);

		await withLuauTypesCheck(
			{ readOptionalTextFile: async (path) => onDisk.get(path) },
			async () => {},
		)();

		expect(stderr.join("")).toBe(
			`warning: ${typesPath} is out of date for this bedrock version; run bedrock setup to refresh it\n`,
		);
	});
});
