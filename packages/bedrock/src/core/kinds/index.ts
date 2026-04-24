import { gamePassKind } from "./game-pass.ts";
import type { KindRegistry } from "./module.ts";
import { placeKind } from "./place.ts";
import { universeKind } from "./universe.ts";

/**
 * Default {@link KindRegistry} composing every resource kind bedrock ships
 * out of the box. Iteration order (`gamePass`, `place`, `universe`)
 * matches the order `flattenConfig` emits entries today, preserving the
 * observable order of generated operations.
 *
 * @example
 *
 * ```ts
 * import { defaultKindRegistry } from "@bedrock/core";
 *
 * expect(defaultKindRegistry.gamePass.kind).toBe("gamePass");
 * expect(defaultKindRegistry.place.kind).toBe("place");
 * expect(defaultKindRegistry.universe.kind).toBe("universe");
 * ```
 */
export const defaultKindRegistry: KindRegistry = {
	gamePass: gamePassKind,
	place: placeKind,
	universe: universeKind,
};
