import type { Result } from "@bedrock/ocale";

import { asSha256Hex, type ResourceKey, type Sha256Hex } from "../types/ids.ts";
import { sha256Hex } from "./kinds/hash.ts";
import type { BuildDesiredError, KindIo } from "./kinds/module.ts";
import { readBytes } from "./kinds/read-bytes.ts";

/**
 * Read one icon file via the injected I/O surface and return its branded
 * SHA-256 hex digest. Composes `readBytes` (which translates rejections
 * into `fileReadFailed` errors) with `sha256Hex` so kind modules and their
 * locale-iterating wrappers do not re-author the same orchestration.
 *
 * @param target - Path of the icon file plus the resource key blamed on
 *   read failure; both are carried unchanged onto `BuildDesiredError`.
 * @param io - I/O surface carrying the injected `readFile`.
 * @returns `Ok` with the branded digest, or `Err` with a `fileReadFailed`
 *   error carrying both `filePath` and `key` unchanged.
 */
export async function hashIconFile(
	target: { readonly filePath: string; readonly key: ResourceKey },
	io: KindIo,
): Promise<Result<Sha256Hex, BuildDesiredError>> {
	const read = await readBytes(target, io);
	if (!read.success) {
		return read;
	}

	return { data: asSha256Hex(await sha256Hex(read.data)), success: true };
}

/**
 * Locale-aware tri-state equality on icon-file hash maps. Used by per-kind
 * `fieldsEqual` implementations to detect drift on resources that carry an
 * optional locale-keyed icon (universe, game-pass, and any future kind that
 * adopts the same shape).
 *
 * The signature widens from kind-typed inputs to hash maps so the helper
 * does not couple to any specific resource-kind shape; callers project the
 * `iconFileHashes` field off their own desired/current values.
 *
 * Tri-state semantics:
 *
 * - both `undefined` (icon absent on both sides): `true`.
 * - one `undefined`, the other present: `false`.
 * - both present: per-locale hash equality on the `"en-us"` key.
 *
 * @param desired - Hashes layered onto the desired-state entry by `normalize`.
 * @param current - Hashes recorded on the prior current-state entry.
 * @returns `true` when no re-upload is implied by the hash comparison.
 */
export function iconHashesEqual(
	desired: Record<"en-us", Sha256Hex> | undefined,
	current: Record<"en-us", Sha256Hex> | undefined,
): boolean {
	if (desired === undefined) {
		return current === undefined;
	}

	if (current === undefined) {
		return false;
	}

	return desired["en-us"] === current["en-us"];
}
