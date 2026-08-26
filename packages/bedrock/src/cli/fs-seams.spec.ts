import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import { nodeMkdirAsync, nodeReadTextFileAsync, nodeWriteTextFileAsync } from "./fs-seams.ts";

function temporaryDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "bedrock-fs-seams-"));
	onTestFinished(() => {
		rmSync(directory, { force: true, recursive: true });
	});
	return directory;
}

describe(nodeMkdirAsync, () => {
	it("should create missing parent directories", async () => {
		expect.assertions(1);

		const nested = join(temporaryDirectory(), "a", "b", "c");

		await nodeMkdirAsync(nested);

		expect(existsSync(nested)).toBeTrue();
	});
});

describe(nodeWriteTextFileAsync, () => {
	it("should write text a later read returns verbatim", async () => {
		expect.assertions(1);

		const filePath = join(temporaryDirectory(), "state.json");

		await nodeWriteTextFileAsync(filePath, '{"environment":"production"}');

		await expect(nodeReadTextFileAsync(filePath)).resolves.toBe('{"environment":"production"}');
	});
});

describe(nodeReadTextFileAsync, () => {
	it("should reject when the file does not exist", async () => {
		expect.assertions(1);

		const missing = join(temporaryDirectory(), "absent.json");

		await expect(nodeReadTextFileAsync(missing)).rejects.toThrow("ENOENT");
	});
});
