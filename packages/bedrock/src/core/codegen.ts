import { asSha256Hex, type Sha256Hex } from "../types/ids.ts";
import { sha256Hex } from "./kinds/hash.ts";
import type { CodegenConfig } from "./schema.ts";
import type { BedrockState } from "./state.ts";

/**
 * A single file the emitter wants written. `path` is relative to the codegen
 * output directory; the writer joins it onto that base. `content` is the
 * UTF-8 source text to write.
 *
 * @since 0.1.0
 */
export interface CodegenFile {
	/** UTF-8 source text to write. */
	readonly content: string;
	/** File path relative to the codegen output directory. */
	readonly path: string;
}

/**
 * Argument handed to a caller-supplied {@link Emitter}. Carries the current
 * state of every declared environment keyed by name: fresh for the one being
 * deployed, last-known for the rest, and an empty snapshot for any that has
 * never been deployed.
 *
 * @since 0.1.0
 */
export interface EmitInput {
	/** Current state of every declared environment, keyed by environment name. */
	readonly environments: Readonly<Record<string, BedrockState>>;
}

/**
 * Caller-supplied function that turns the per-environment state into the files
 * bedrock writes. Returns a keyed array of files (sync or async); bedrock
 * writes them through the injected writer but never commits them.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import type { Emitter } from "@bedrock-rbx/core";
 *
 * const emit: Emitter = ({ environments }) => {
 *     const count = environments["production"]?.resources.length ?? 0;
 *     return [{ content: `return { count = ${String(count)} }\n`, path: "ids.luau" }];
 * };
 *
 * const files = emit({
 *     environments: { production: { environment: "production", resources: [], version: 1 } },
 * });
 * expect(files).toStrictEqual([{ content: "return { count = 0 }\n", path: "ids.luau" }]);
 * ```
 */
export type Emitter = (
	input: EmitInput,
) => Promise<ReadonlyArray<CodegenFile>> | ReadonlyArray<CodegenFile>;

/**
 * Assemble the per-environment state map handed to an {@link Emitter}. Each
 * supplied state is kept as-is; a `undefined` value (a never-deployed
 * environment) is normalized to an empty snapshot carrying that environment's
 * name, so an emitter can decide whether to omit it or emit a placeholder.
 *
 * @param states - Declared environments keyed by name, each mapped to its
 * current state or `undefined` when it has never been deployed.
 * @returns The same map with every `undefined` replaced by an empty state.
 */
export function buildCodegenEnvironments(
	states: Readonly<Record<string, BedrockState | undefined>>,
): Record<string, BedrockState> {
	const environments: Record<string, BedrockState> = {};
	for (const [environment, state] of Object.entries(states)) {
		environments[environment] = state ?? { environment, resources: [], version: 1 };
	}

	return environments;
}

/**
 * Fingerprint the emitted codegen output so a two-phase deploy can tell whether
 * the generated source would change. The digest is order-independent (files are
 * sorted by `path` first) so a reordered emitter return does not spuriously
 * trigger a rebuild, and the canonical form is a JSON array of `[path, content]`
 * pairs so no path/content boundary shift collides.
 *
 * @param files - The files the emitter returned for the deployed environment.
 * @returns The branded SHA-256 hex digest of the canonicalized output.
 */
export async function hashCodegenFiles(files: ReadonlyArray<CodegenFile>): Promise<Sha256Hex> {
	// Each file becomes the unambiguous JSON of its `[path, content]` pair, the
	// pairs are sorted as strings (a deterministic total order, so a reordered
	// emitter return hashes the same), and the sorted list is hashed. JSON keys
	// rule out a path/content boundary shift colliding two distinct files.
	const canonical = JSON.stringify(
		files.map((file) => JSON.stringify([file.path, file.content])).sort(),
	);
	return asSha256Hex(await sha256Hex(new TextEncoder().encode(canonical)));
}

/**
 * Whether codegen should run for a deploy. Opt-in: only an explicit
 * `enabled: true` activates it; an absent section or any other value keeps
 * Mantle-parity behaviour.
 *
 * @param codegen - The resolved `codegen` config section, or `undefined`.
 * @returns `true` when codegen is explicitly enabled.
 */
export function isCodegenEnabled(codegen: CodegenConfig | undefined): boolean {
	return codegen?.enabled === true;
}
