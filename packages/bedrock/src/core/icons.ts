import type { Sha256Hex } from "../types/ids.ts";

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
