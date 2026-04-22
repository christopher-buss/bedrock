import type { Result } from "@bedrock/ocale";

import type { ResourceDesiredInput } from "../core/flatten.ts";
import type { ResourceDesiredState } from "../core/resources.ts";
import { asSha256Hex, type ResourceKey } from "../types/ids.ts";

/**
 * Failure surfaced by `buildDesired` when the I/O step for a resource input
 * cannot complete. Validation and key-shape errors are caught upstream by
 * the schema (`validateConfig`); by the time inputs reach `buildDesired`
 * they are already well-formed, so the only remaining failure mode is
 * reading the icon bytes.
 *
 * @example
 *
 * ```ts
 * import { asResourceKey, type BuildDesiredError } from "bedrock";
 *
 * const err: BuildDesiredError = {
 *     iconFilePath: "assets/vip-icon.png",
 *     key: asResourceKey("vip-pass"),
 *     kind: "iconReadFailed",
 *     reason: "ENOENT",
 * };
 *
 * expect(err.kind).toBe("iconReadFailed");
 * ```
 */
export interface BuildDesiredError {
	/** ResourceKey of the input whose icon failed to read. */
	readonly key: ResourceKey;
	/** Path of the icon file that failed to read. */
	readonly iconFilePath: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "iconReadFailed";
	/** Human-readable explanation; typically the caught error message. */
	readonly reason: string;
}

/**
 * Layer icon-file I/O onto a flat tagged list of resource inputs to produce
 * `ResourceDesiredState`.
 *
 * For each input, reads the icon bytes via the injected `readFile`, computes
 * the SHA-256 hex digest, and assembles the branded desired-state record
 * that `diff` consumes. Entries are processed sequentially so the first
 * failure's attribution is deterministic.
 *
 * @param inputs - Flat tagged resource inputs from `flattenConfig`.
 * @param readFile - Reads icon bytes for a given path; rejection becomes an
 * `iconReadFailed` Err.
 * @returns `Ok` with the desired-state array (same length and order as
 * `inputs`), or `Err` with the first I/O failure.
 * @example
 *
 * ```ts
 * import { asResourceKey, buildDesired } from "bedrock";
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
	const buffer = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

async function readIconBytes(
	input: ResourceDesiredInput,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<Uint8Array, BuildDesiredError>> {
	try {
		return { data: await readFile(input.iconFilePath), success: true };
	} catch (err) {
		return {
			err: {
				key: input.key,
				iconFilePath: input.iconFilePath,
				kind: "iconReadFailed",
				reason: err instanceof Error ? err.message : String(err),
			},
			success: false,
		};
	}
}

async function normalizeInput(
	input: ResourceDesiredInput,
	readFile: (path: string) => Promise<Uint8Array>,
): Promise<Result<ResourceDesiredState, BuildDesiredError>> {
	const read = await readIconBytes(input, readFile);
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
