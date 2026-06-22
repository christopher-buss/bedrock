import type { Result } from "@bedrock-rbx/ocale";

import type { CodegenFile } from "../core/codegen.ts";

/**
 * Failure surfaced by a {@link CodegenWriterPort} when a generated file could
 * not be written: a missing output directory, a permission error, or any
 * other failure of the underlying sink.
 *
 * Narrow on `kind` rather than using `instanceof`: `CodegenWriteError` is
 * plain data, not a thrown error subclass.
 */
export interface CodegenWriteError {
	/** Literal discriminator for narrowing. */
	readonly kind: "codegenWriteError";
	/** Path of the file that failed to write, as the writer resolved it. */
	readonly path: string;
	/** Human-readable explanation of why the write failed. */
	readonly reason: string;
}

/**
 * Plugin contract for writing the files codegen produces: the interface an
 * adapter (node filesystem, in-memory capture, cloud object store) implements
 * to let bedrock persist a {@link CodegenFile}.
 *
 * `CodegenWriterPort` is a *driven* (secondary) port in hexagonal terms,
 * following the same naming convention as {@link "./state-port".StatePort}.
 * Bedrock writes through it but never commits the result; the output is always
 * regenerable from state.
 */
export interface CodegenWriterPort {
	/**
	 * Writes a single generated file. The file's `path` is relative to the
	 * adapter's configured output location; the adapter resolves it.
	 */
	write(file: CodegenFile): Promise<Result<void, CodegenWriteError>>;
}
