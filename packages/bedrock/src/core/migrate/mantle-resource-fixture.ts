import type { MantleResource } from "./types.ts";

/**
 * Build a minimal `MantleResource` for spec inputs that exercise a fold's
 * kind-discrimination path without depending on per-kind input or output
 * shapes. Empty `inputs`, `undefined` outputs, no dependencies.
 *
 * @param kind - Resource discriminator (the `kind` field on `MantleResource`).
 * @param key - Stable resource key (the `key` field on `MantleResource`).
 * @returns A bare `MantleResource` with empty payloads.
 */
export function mantleResource(kind: string, key: string): MantleResource {
	return { key, dependencies: [], inputs: {}, kind, outputs: undefined };
}
