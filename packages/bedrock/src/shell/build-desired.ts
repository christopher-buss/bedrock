import type { Result } from "@bedrock-rbx/ocale";

import type { ResourceDesiredInput } from "../core/flatten.ts";
import { defaultKindRegistry } from "../core/kinds/index.ts";
import type { BuildDesiredError, ResourceKindModule } from "../core/kinds/module.ts";
import type { ResourceDesiredState, ResourceKind } from "../core/resources.ts";

export type { BuildDesiredError } from "../core/kinds/module.ts";

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
 * @param inputs - Flat tagged resource inputs from `flattenConfig`.
 * @param readFile - Reads file bytes for a given path; rejection becomes a
 * `fileReadFailed` Err.
 * @returns `Ok` with the desired-state array (same length and order as
 * `inputs`), or `Err` with the first I/O failure.
 * @example
 *
 * ```ts
 * import { asResourceKey, buildDesired } from "@bedrock-rbx/core";
 *
 * async function readFile(): Promise<Uint8Array> {
 *     return new Uint8Array([1, 2, 3]);
 * }
 *
 * return buildDesired(
 *     [
 *         {
 *             description: "Grants VIP perks.",
 *             icon: { "en-us": "assets/vip-icon.png" },
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
	const io = { readFile };
	for (const input of inputs) {
		// Registry index returns a union of per-kind modules; widening its
		// type parameter lets us call normalize without per-kind
		// discriminator narrowing. Safe because input.kind pins which
		// module is selected.
		const module = defaultKindRegistry[input.kind] as ResourceKindModule<ResourceKind>;
		const normalized = await module.normalize(input, io);
		if (!normalized.success) {
			return normalized;
		}

		desired.push(normalized.data);
	}

	return { data: desired, success: true };
}
