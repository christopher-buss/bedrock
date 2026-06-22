import type { Result } from "@bedrock-rbx/ocale";

import { mkdir as nodeMkdir, writeFile as nodeWriteFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { CodegenFile } from "../core/codegen.ts";
import type { CodegenWriteError, CodegenWriterPort } from "../ports/codegen-writer.ts";

/**
 * Configuration for {@link createFsCodegenWriter}. `mkdir` and `writeFile`
 * default to `node:fs/promises`; tests inject fakes so the suite never touches
 * disk.
 */
export interface FsCodegenWriterDeps {
	/**
	 * Injection seam for directory creation; defaults to
	 * `node:fs/promises.mkdir`. Called with the file's parent directory and
	 * `{ recursive: true }`.
	 */
	readonly mkdir?:
		| ((path: string, options: { readonly recursive: true }) => Promise<unknown>)
		| undefined;
	/** Directory generated files are written under; each file's path is joined onto it. */
	readonly outputDir: string;
	/** Injection seam for the file write; defaults to `node:fs/promises.writeFile` (UTF-8). */
	readonly writeFile?: ((path: string, data: string) => Promise<void>) | undefined;
}

/**
 * Build a {@link CodegenWriterPort} backed by the node filesystem. Each write
 * resolves the file's `path` against `outputDir`, creates the parent directory
 * recursively, and writes the content as UTF-8. A thrown filesystem error is
 * mapped to a {@link CodegenWriteError} naming the resolved path.
 *
 * @param deps - Output directory plus optional filesystem injection seams.
 * @returns A writer port that persists files under `outputDir`.
 * @example
 *
 * ```ts
 * import { createFsCodegenWriter } from "@bedrock-rbx/core";
 *
 * const writes: Array<{ content: string; path: string }> = [];
 * const writer = createFsCodegenWriter({
 *     mkdir: async () => undefined,
 *     outputDir: "src/generated",
 *     writeFile: async (path, content) => {
 *         writes.push({ content, path });
 *     },
 * });
 *
 * return writer.write({ content: "return {}\n", path: "ids.luau" }).then((result) => {
 *     expect(result.success).toBeTrue();
 *     expect(writes[0]?.content).toBe("return {}\n");
 *     expect(writes[0]?.path).toContain("ids.luau");
 * });
 * ```
 */
export function createFsCodegenWriter(deps: FsCodegenWriterDeps): CodegenWriterPort {
	const makeDirectory = deps.mkdir ?? nodeMkdir;
	const write = deps.writeFile ?? nodeWriteFile;

	return {
		async write(file: CodegenFile): Promise<Result<void, CodegenWriteError>> {
			const path = join(deps.outputDir, file.path);
			try {
				await makeDirectory(dirname(path), { recursive: true });
				await write(path, file.content);
				return { data: undefined, success: true };
			} catch (err) {
				return {
					err: { kind: "codegenWriteError", path, reason: toReason(err) },
					success: false,
				};
			}
		},
	};
}

function toReason(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
