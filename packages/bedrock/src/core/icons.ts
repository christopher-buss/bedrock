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
 * Hash every locale entry on a declared icon map, producing a hash map
 * keyed by the same locales. Iterates `hashIconFile` per locale so each
 * read failure surfaces the offending file's path verbatim. Stamped onto
 * desired-state entries by per-kind `normalize` implementations.
 *
 * @param input - Declared icon paths plus the resource key blamed on
 *   read failure.
 * @param io - I/O surface carrying the injected `readFile`.
 * @returns `Ok` with hashes mirroring the locale shape of the input, or
 *   `Err` from the first locale whose file could not be read.
 */
export async function hashIconLocales(
	input: { readonly icon: Record<"en-us", string>; readonly key: ResourceKey },
	io: KindIo,
): Promise<Result<Record<"en-us", Sha256Hex>, BuildDesiredError>> {
	const enUs = await hashIconFile({ key: input.key, filePath: input.icon["en-us"] }, io);
	if (!enUs.success) {
		return enUs;
	}

	return { data: { "en-us": enUs.data }, success: true };
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

/**
 * Cost-gate for icon re-uploads. Returns `true` when the locally-hashed
 * desired icon differs from the hash recorded on the prior current-state
 * entry, signalling that the driver must re-upload before reconciling.
 * Returns `false` when the hashes match (no re-upload needed) or when both
 * sides report no icon (precondition: the caller has already short-circuited
 * the no-icon-declared case before consulting this helper).
 *
 * The signature takes hash maps directly (not whole-state) so the helper
 * is independent of any specific resource-kind shape; every icon-bearing
 * driver projects its own `iconFileHashes` and `outputs.iconFileHashes`
 * fields before calling.
 *
 * @param currentHashes - Hashes recorded on the prior current-state entry.
 * @param desiredHashes - Hashes layered onto the desired-state entry by
 *   `normalize` from the local icon file's bytes.
 * @returns `true` when the driver should re-upload the icon.
 *
 * @example
 *
 * ```ts
 * import { asSha256Hex, shouldReuploadIcon } from "@bedrock/core";
 *
 * const previous = asSha256Hex(
 *     "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
 * );
 * const fresh = asSha256Hex(
 *     "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
 * );
 *
 * expect(shouldReuploadIcon({ "en-us": previous }, { "en-us": previous })).toBe(false);
 * expect(shouldReuploadIcon({ "en-us": previous }, { "en-us": fresh })).toBe(true);
 * ```
 */
export function shouldReuploadIcon(
	currentHashes: Record<"en-us", Sha256Hex> | undefined,
	desiredHashes: Record<"en-us", Sha256Hex> | undefined,
): boolean {
	return !iconHashesEqual(desiredHashes, currentHashes);
}
