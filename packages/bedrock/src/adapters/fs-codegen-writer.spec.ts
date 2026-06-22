import { dirname, join } from "node:path";
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
