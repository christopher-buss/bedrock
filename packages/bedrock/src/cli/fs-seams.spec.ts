import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "vitest";

import {
	nodeMkdirAsync,
	nodeReadOptionalTextFileAsync,
	nodeReadTextFileAsync,
	nodeRemoveFileAsync,
	nodeRenameFileAsync,
	nodeWriteTextFileAsync,
} from "./fs-seams.ts";

function temporaryDirectory(onTestFinished: TestContext["onTestFinished"]): string {
	const directory = mkdtempSync(join(tmpdir(), "bedrock-fs-seams-"));
	onTestFinished(() => {
		rmSync(directory, { force: true, recursive: true });
	});
	return directory;
}

describe(nodeMkdirAsync, () => {
	it("should create missing parent directories", async ({ expect, onTestFinished }) => {
		expect.assertions(1);

		const nested = join(temporaryDirectory(onTestFinished), "a", "b", "c");

		await nodeMkdirAsync(nested);

		expect(existsSync(nested)).toBeTrue();
	});
});

describe(nodeWriteTextFileAsync, () => {
	it("should write text a later read returns verbatim", async ({ expect, onTestFinished }) => {
		expect.assertions(1);

		const filePath = join(temporaryDirectory(onTestFinished), "state.json");

		await nodeWriteTextFileAsync(filePath, '{"environment":"production"}');

		await expect(nodeReadTextFileAsync(filePath)).resolves.toBe('{"environment":"production"}');
	});
});

describe(nodeRenameFileAsync, () => {
	it("should replace the target with the moved file", async ({ expect, onTestFinished }) => {
		expect.assertions(2);

		const directory = temporaryDirectory(onTestFinished);
		const from = join(directory, ".config.luau.tmp");
		const to = join(directory, ".config.luau");
		await nodeWriteTextFileAsync(from, "return { new = true }");
		await nodeWriteTextFileAsync(to, "return {}");

		await nodeRenameFileAsync(from, to);

		await expect(nodeReadTextFileAsync(to)).resolves.toBe("return { new = true }");
		expect(existsSync(from)).toBeFalse();
	});
});

describe(nodeReadTextFileAsync, () => {
	it("should reject when the file does not exist", async ({ expect, onTestFinished }) => {
		expect.assertions(1);

		const missing = join(temporaryDirectory(onTestFinished), "absent.json");

		await expect(nodeReadTextFileAsync(missing)).rejects.toThrow("ENOENT");
	});
});

describe(nodeReadOptionalTextFileAsync, () => {
	it("should resolve the contents of a file that exists", async ({ expect, onTestFinished }) => {
		expect.assertions(1);

		const filePath = join(temporaryDirectory(onTestFinished), ".luaurc");
		await nodeWriteTextFileAsync(filePath, "{}");

		await expect(nodeReadOptionalTextFileAsync(filePath)).resolves.toBe("{}");
	});

	it("should resolve undefined when the file does not exist", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		const missing = join(temporaryDirectory(onTestFinished), "absent.json");

		await expect(nodeReadOptionalTextFileAsync(missing)).resolves.toBeUndefined();
	});

	it("should reject when the path cannot be read as a file", async ({
		expect,
		onTestFinished,
	}) => {
		expect.assertions(1);

		const directory = temporaryDirectory(onTestFinished);

		await expect(nodeReadOptionalTextFileAsync(directory)).rejects.toThrow("EISDIR");
	});
});

describe(nodeRemoveFileAsync, () => {
	it("should delete the file", async ({ expect, onTestFinished }) => {
		expect.assertions(1);

		const filePath = join(temporaryDirectory(onTestFinished), "state.json");
		await nodeWriteTextFileAsync(filePath, "{}");

		await nodeRemoveFileAsync(filePath);

		expect(existsSync(filePath)).toBeFalse();
	});

	it("should resolve when the file is already gone", async ({ expect, onTestFinished }) => {
		expect.assertions(1);

		const missing = join(temporaryDirectory(onTestFinished), "absent.json");

		await expect(nodeRemoveFileAsync(missing)).resolves.toBeUndefined();
	});
});
