import type { Result } from "@bedrock-rbx/ocale";

import type { ResourceDesiredInput } from "../core/flatten.ts";
import { normalizeInputAsync } from "../core/kinds/dispatch.ts";
import type { BuildDesiredError } from "../core/kinds/module.ts";
import type { ResourceDesiredState, ResourceKind } from "../core/resources.ts";

export type { BuildDesiredError } from "../core/kinds/module.ts";

interface BuildDesiredInputs {
	/**
	 * Restricts processing to inputs whose kind satisfies the predicate. A
	 * skipped input is neither read nor included, so a caller reconciling only
	 * a subset of kinds (an asset-only provision, a place-only publish) does no
	 * file I/O for the kinds it does not own. Omit to process every input.
	 */
	readonly includeKind?: ((kind: ResourceKind) => boolean) | undefined;
	/**
	 * Reads file bytes for a given path; rejection becomes a `fileReadFailed`
	 * Err.
	 */
	readonly readFile: (path: string) => Promise<Uint8Array>;
	/** Flat tagged resource inputs from `flattenConfig`. */
	readonly resources: ReadonlyArray<ResourceDesiredInput>;
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
 * @since 0.1.0
 *
 * @param inputs - The resource inputs, file reader, and optional `includeKind`
 * filter. See {@link BuildDesiredInputs}.
 * @returns `Ok` with the desired-state array (in input order, limited to the
 * kinds `includeKind` admits), or `Err` with the first I/O failure.
 * @example
 *
 * ```ts
 * import { asResourceKey, buildDesired } from "@bedrock-rbx/core";
 *
 * async function readFile(): Promise<Uint8Array> {
 *     return new Uint8Array([1, 2, 3]);
 * }
 *
 * return buildDesired({
 *     readFile,
 *     resources: [
 *         {
 *             description: "Grants VIP perks.",
 *             icon: { "en-us": "assets/vip-icon.png" },
 *             key: asResourceKey("vip-pass"),
 *             kind: "gamePass",
 *             name: "VIP Pass",
 *             price: 500,
 *         },
 *     ],
 * }).then((result) => {
 *     expect(result.success).toBeTrue();
 *     if (result.success) {
 *         expect(result.data).toHaveLength(1);
 *         expect(result.data[0]!.kind).toBe("gamePass");
 *     }
 * });
 * ```
 */
export async function buildDesired({
	includeKind,
	readFile,
	resources,
}: BuildDesiredInputs): Promise<Result<ReadonlyArray<ResourceDesiredState>, BuildDesiredError>> {
	const desired: Array<ResourceDesiredState> = [];
	const io = { readFile };
	for (const input of resources) {
		if (includeKind !== undefined && !includeKind(input.kind)) {
			continue;
		}

		const normalized = await normalizeInputAsync(input, io);
		if (!normalized.success) {
			return normalized;
		}

		desired.push(normalized.data);
	}

	return { data: desired, success: true };
}
