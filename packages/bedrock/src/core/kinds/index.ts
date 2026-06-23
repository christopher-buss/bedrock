import { developerProductKind } from "./developer-product.ts";
import { gamePassKind } from "./game-pass.ts";
import type { KindRegistry } from "./module.ts";
import { placeKind } from "./place.ts";
import { universeKind } from "./universe.ts";

/**
 * Default {@link KindRegistry} composing every resource kind bedrock ships
 * out of the box. Iteration order (`gamePass`, `place`, `universe`,
 * `developerProduct`) matches the order `flattenConfig` emits entries
 * today, preserving the observable order of generated operations.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { defaultKindRegistry } from "@bedrock-rbx/core";
 *
 * expect(defaultKindRegistry.gamePass.kind).toBe("gamePass");
 * expect(defaultKindRegistry.place.kind).toBe("place");
 * expect(defaultKindRegistry.universe.kind).toBe("universe");
 * expect(defaultKindRegistry.developerProduct.kind).toBe("developerProduct");
 * ```
 */
export const defaultKindRegistry: KindRegistry = {
	developerProduct: developerProductKind,
	gamePass: gamePassKind,
	place: placeKind,
	universe: universeKind,
};
