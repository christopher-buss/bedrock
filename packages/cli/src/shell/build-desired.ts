import type { Result } from "@bedrock/ocale";

import type { ResourceDesiredState } from "../core/resources.ts";
import { asSha256Hex, isResourceKey, type ResourceKey } from "../types/ids.ts";

/**
 * Single game-pass entry the caller assembles by hand to drive
 * `buildDesired` in slice 1. Interim scaffolding: slice 2's c12 loader will
 * replace this with a stable `defineConfig` contract; do not depend on this
 * shape from outside the shell module.
 */
export interface GamePassConfigInput {
	/** User-supplied handle; validated against the `ResourceKey` brand regex. */
	readonly key: string;
	/** Name shown on the Roblox storefront. Passed through verbatim. */
	readonly name: string;
	/** Description shown on the game-pass detail page. Passed through verbatim. */
	readonly description: string;
	/** Path to the icon file; handed to the injected `readFile` without resolution. */
	readonly iconFilePath: string;
	/** Robux price, or `undefined` for off-sale. Mirrors Mantle's `Option<u32>`. */
	readonly price: number | undefined;
}

/**
 * Top-level slice-1 config shape. Mirrors the fields the slice-2 c12 loader
 * will produce so the same tests keep passing once the loader lands. Not a
 * stable public API.
 */
export interface Slice1ConfigInput {
	/** Every game pass the caller wants reconciled. Order is preserved downstream. */
	readonly gamePasses: ReadonlyArray<GamePassConfigInput>;
}

/**
 * Failure surfaced by `buildDesired` when the slice-1 config cannot be
 * normalized into `ResourceDesiredState`. Plain-data discriminated union
 * following the `StateError` pattern in `core/state.ts`; narrow on `kind`,
 * do not `instanceof` it.
 */
export type BuildDesiredError =
	| {
			readonly iconFilePath: string;
			readonly key: ResourceKey;
			readonly kind: "iconReadFailed";
			readonly reason: string;
	  }
	| {
			readonly kind: "invalidKey";
			readonly rawKey: string;
	  };

interface ValidatedEntry {
	readonly key: ResourceKey;
	readonly source: GamePassConfigInput;
}

/**
 * Normalize a slice-1 config into the `ResourceDesiredState[]` that `diff`
 * consumes. Reads each icon file via the injected `readFile`, computes its
 * SHA-256 hex digest, and assembles the branded desired-state record.
 *
 * Behaviour:
 * - Keys are validated synchronously up-front; an `invalidKey` error returns
 *   before any icon is read (so a later bad key skips earlier I/O).
 * - Entries are processed sequentially, not via `Promise.all`, so first-fail
 *   error attribution is deterministic.
 * - `iconFilePath` is passed to `readFile` verbatim; path resolution is the
 *   caller's responsibility (the slice-2 c12 loader closes over the config
 *   directory before invoking `buildDesired`).
 * @param config - Slice-1 config carrying every game pass to normalize.
 * @param readFile - Reads icon bytes for a given path; rejection becomes an `iconReadFailed` Err.
 * @returns `Ok` with the normalized desired state array, or `Err` with the first validation or I/O failure.
 */
export async function buildDesired(
	config: Slice1ConfigInput,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<ReadonlyArray<ResourceDesiredState>, BuildDesiredError>> {
	const validation = validateKeys(config);
	if (!validation.success) {
		return validation;
	}

	const desired: Array<ResourceDesiredState> = [];
	for (const entry of validation.data) {
		const normalized = await normalizeEntry(entry, readFile);
		if (!normalized.success) {
			return normalized;
		}

		desired.push(normalized.data);
	}

	return { data: desired, success: true };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const buffer = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

async function readIconBytes(
	entry: ValidatedEntry,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<Uint8Array, BuildDesiredError>> {
	try {
		return { data: await readFile(entry.source.iconFilePath), success: true };
	} catch (err) {
		return {
			err: {
				key: entry.key,
				iconFilePath: entry.source.iconFilePath,
				kind: "iconReadFailed",
				reason: err instanceof Error ? err.message : String(err),
			},
			success: false,
		};
	}
}

async function normalizeEntry(
	entry: ValidatedEntry,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<ResourceDesiredState, BuildDesiredError>> {
	const read = await readIconBytes(entry, readFile);
	if (!read.success) {
		return read;
	}

	const { key, source } = entry;
	return {
		data: {
			key,
			name: source.name,
			description: source.description,
			iconFileHash: asSha256Hex(await sha256Hex(read.data)),
			iconFilePath: source.iconFilePath,
			kind: "gamePass",
			price: source.price,
		},
		success: true,
	};
}

function validateKeys(
	config: Slice1ConfigInput,
): Result<ReadonlyArray<ValidatedEntry>, BuildDesiredError> {
	const validated: Array<ValidatedEntry> = [];
	for (const gamePass of config.gamePasses) {
		if (!isResourceKey(gamePass.key)) {
			return { err: { kind: "invalidKey", rawKey: gamePass.key }, success: false };
		}

		validated.push({ key: gamePass.key, source: gamePass });
	}

	return { data: validated, success: true };
}
