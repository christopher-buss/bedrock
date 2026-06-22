import { dirname, join, resolve } from "node:path";
import { assert, describe, expect, it, vi } from "vitest";

import type { CodegenFile } from "../core/codegen.ts";
import { createFsCodegenWriter, type FsCodegenWriterDeps } from "./fs-codegen-writer.ts";

const OUTPUT_DIR = join("src", "generated");
const FILE: CodegenFile = { content: "return {}\n", path: join("ids", "passes.luau") };

function fakeMkdir(): FsCodegenWriterDeps["mkdir"] {
	return vi.fn<(path: string, options: { readonly recursive: true }) => Promise<undefined>>(
		async () => {},
	);
}

function fakeWriteFile(): FsCodegenWriterDeps["writeFile"] {
	return vi.fn<(path: string, data: string) => Promise<void>>(async () => {});
}

describe(createFsCodegenWriter, () => {
	it("should write the file content under the joined output path", async () => {
		expect.assertions(1);

		const writeFile = fakeWriteFile();
		const writer = createFsCodegenWriter({
			mkdir: fakeMkdir(),
			outputDir: OUTPUT_DIR,
			writeFile,
		});

		const result = await writer.write(FILE);

		assert(result.success);

		expect(writeFile).toHaveBeenCalledExactlyOnceWith(
			join(OUTPUT_DIR, "ids", "passes.luau"),
			"return {}\n",
		);
	});

	it("should create the file's parent directory recursively before writing", async () => {
		expect.assertions(1);

		const mkdir = fakeMkdir();
		const writer = createFsCodegenWriter({
			mkdir,
			outputDir: OUTPUT_DIR,
			writeFile: fakeWriteFile(),
		});

		await writer.write(FILE);

		expect(mkdir).toHaveBeenCalledExactlyOnceWith(
			dirname(join(OUTPUT_DIR, "ids", "passes.luau")),
			{
				recursive: true,
			},
		);
	});

	it("should map a directory-creation failure to a codegen write error naming the path", async () => {
		expect.assertions(3);

		const mkdir = vi
			.fn<(path: string, options: { readonly recursive: true }) => Promise<undefined>>()
			.mockRejectedValue(new Error("EACCES: permission denied"));
		const writer = createFsCodegenWriter({
			mkdir,
			outputDir: OUTPUT_DIR,
			writeFile: fakeWriteFile(),
		});

		const result = await writer.write(FILE);

		assert(!result.success);

		expect(result.err.kind).toBe("codegenWriteError");
		expect(result.err.path).toBe(join(OUTPUT_DIR, "ids", "passes.luau"));
		expect(result.err.reason).toBe("EACCES: permission denied");
	});

	it("should reject a relative path that escapes the output directory without touching the filesystem", async () => {
		expect.assertions(3);

		const mkdir = fakeMkdir();
		const writeFile = fakeWriteFile();
		const writer = createFsCodegenWriter({ mkdir, outputDir: OUTPUT_DIR, writeFile });

		const result = await writer.write({ content: "x", path: join("..", "escape.luau") });

		assert(!result.success);

		expect(result.err.reason).toContain("escapes the codegen output directory");
		expect(mkdir).not.toHaveBeenCalled();
		expect(writeFile).not.toHaveBeenCalled();
	});

	it("should reject an absolute path even when it points inside the output directory", async () => {
		expect.assertions(2);

		const writeFile = fakeWriteFile();
		const writer = createFsCodegenWriter({
			mkdir: fakeMkdir(),
			outputDir: OUTPUT_DIR,
			writeFile,
		});

		// Absolute and inside the output dir: only the absolute-path guard can
		// reject this, since the `..`-relative check would otherwise accept it.
		const result = await writer.write({ content: "x", path: resolve(OUTPUT_DIR, "ids.luau") });

		assert(!result.success);

		expect(result.err.kind).toBe("codegenWriteError");
		expect(writeFile).not.toHaveBeenCalled();
	});

	it("should stringify a non-Error write rejection into the failure reason", async () => {
		expect.assertions(2);

		const writeFile = vi
			.fn<(path: string, data: string) => Promise<void>>()
			.mockRejectedValue("disk full");
		const writer = createFsCodegenWriter({
			mkdir: fakeMkdir(),
			outputDir: OUTPUT_DIR,
			writeFile,
		});

		const result = await writer.write(FILE);

		assert(!result.success);

		expect(result.err.kind).toBe("codegenWriteError");
		expect(result.err.reason).toBe("disk full");
	});
});
