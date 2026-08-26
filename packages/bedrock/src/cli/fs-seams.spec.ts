import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import { nodeMkdirAsync, nodeWriteTextFileAsync } from "./fs-seams.ts";

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
	it("should write the text as utf-8", async () => {
		expect.assertions(1);

		const filePath = join(temporaryDirectory(), "state.json");

		await nodeWriteTextFileAsync(filePath, '{"environment":"production"}');

		expect(readFileSync(filePath, "utf8")).toBe('{"environment":"production"}');
	});
});
