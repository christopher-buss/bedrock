import type { Result } from "@bedrock/ocale";

import type { ResourceDesiredInput } from "../core/flatten.ts";
import type { ResourceDesiredState } from "../core/resources.ts";
import { asSha256Hex, type ResourceKey } from "../types/ids.ts";

/**
 * Failure surfaced by `buildDesired` when the I/O step for a resource input
 * cannot complete. Validation and key-shape errors are caught upstream by
 * the schema (`validateConfig`); by the time inputs reach `buildDesired`
 * they are already well-formed, so the only remaining failure mode is
 * reading the file bytes.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, type BuildDesiredError } from "@bedrock/core";
 *
 * const err: BuildDesiredError = {
 *     filePath: "assets/vip-icon.png",
 *     key: asResourceKey("vip-pass"),
 *     kind: "fileReadFailed",
 *     reason: "ENOENT",
 * };
 *
 * expect(err.kind).toBe("fileReadFailed");
 * ```
 */
export interface BuildDesiredError {
	/** ResourceKey of the input whose file failed to read. */
	readonly key: ResourceKey;
	/** Path of the file that failed to read. */
	readonly filePath: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "fileReadFailed";
	/** Human-readable explanation; typically the caught error message. */
	readonly reason: string;
}

/**
 * Layer file I/O onto a flat tagged list of resource inputs to produce
 * `ResourceDesiredState`.
 *
 * For each input, reads the file bytes via the injected `readFile`, computes
 * the SHA-256 hex digest, and assembles the branded desired-state record
 * that `diff` consumes. Entries are processed sequentially so the first
 * failure's attribution is deterministic.
 *
 * @param inputs - Flat tagged resource inputs from `flattenConfig`.
 * @param readFile - Reads file bytes for a given path; rejection becomes a
 * `fileReadFailed` Err.
 * @returns `Ok` with the desired-state array (same length and order as
 * `inputs`), or `Err` with the first I/O failure.
 * @example
 *
 * ```ts
 * import { asResourceKey, buildDesired } from "@bedrock/core";
 *
 * async function readFile(): Promise<Uint8Array> {
 *     return new Uint8Array([1, 2, 3]);
 * }
 *
 * return buildDesired(
 *     [
 *         {
 *             description: "Grants VIP perks.",
 *             iconFilePath: "assets/vip-icon.png",
 *             key: asResourceKey("vip-pass"),
 *             kind: "gamePass",
 *             name: "VIP Pass",
 *             price: 500,
 *         },
 *     ],
 *     readFile,
 * ).then((result) => {
 *     expect(result.success).toBeTrue();
 *     if (result.success) {
 *         expect(result.data).toHaveLength(1);
 *         expect(result.data[0]!.kind).toBe("gamePass");
 *     }
 * });
 * ```
 */
export async function buildDesired(
	inputs: ReadonlyArray<ResourceDesiredInput>,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<ReadonlyArray<ResourceDesiredState>, BuildDesiredError>> {
	const desired: Array<ResourceDesiredState> = [];
	for (const input of inputs) {
		const normalized = await normalizeInput(input, readFile);
		if (!normalized.success) {
			return normalized;
		}

		desired.push(normalized.data);
	}

	return { data: desired, success: true };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	// `Uint8Array.from(bytes)` narrows `Uint8Array<ArrayBufferLike>` to
	// `Uint8Array<ArrayBuffer>` for `crypto.subtle.digest`, which rejects the
	// SharedArrayBuffer variant at the type level.
	const buffer = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

async function readBytes(
	target: { filePath: string; key: ResourceKey },
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<Uint8Array, BuildDesiredError>> {
	try {
		return { data: await readFile(target.filePath), success: true };
	} catch (err) {
		return {
			err: {
				key: target.key,
				filePath: target.filePath,
				kind: "fileReadFailed",
				reason: err instanceof Error ? err.message : String(err),
			},
			success: false,
		};
	}
}

async function normalizeGamePass(
	input: Extract<ResourceDesiredInput, { kind: "gamePass" }>,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<ResourceDesiredState, BuildDesiredError>> {
	const read = await readBytes({ key: input.key, filePath: input.iconFilePath }, readFile);
	if (!read.success) {
		return read;
	}

	return {
		data: {
			key: input.key,
			name: input.name,
			description: input.description,
			iconFileHash: asSha256Hex(await sha256Hex(read.data)),
			iconFilePath: input.iconFilePath,
			kind: "gamePass",
			price: input.price,
		},
		success: true,
	};
}

async function normalizePlace(
	input: Extract<ResourceDesiredInput, { kind: "place" }>,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<ResourceDesiredState, BuildDesiredError>> {
	const read = await readBytes({ key: input.key, filePath: input.filePath }, readFile);
	if (!read.success) {
		return read;
	}

	return {
		data: {
			key: input.key,
			fileHash: asSha256Hex(await sha256Hex(read.data)),
			filePath: input.filePath,
			kind: "place",
			placeId: input.placeId,
		},
		success: true,
	};
}

async function normalizeInput(
	input: ResourceDesiredInput,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<ResourceDesiredState, BuildDesiredError>> {
	return input.kind === "gamePass"
		? normalizeGamePass(input, readFile)
		: normalizePlace(input, readFile);
}
