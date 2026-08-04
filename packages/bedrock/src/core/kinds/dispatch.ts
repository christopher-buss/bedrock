import type { Result } from "@bedrock-rbx/ocale";

import type { ResourceDesiredInput } from "../flatten.ts";
import type { ResourceCurrentState, ResourceDesiredState } from "../resources.ts";
import type { ResolvedConfig } from "../schema.ts";
import { defaultKindRegistry } from "./index.ts";
import type { BuildDesiredError, KindIo } from "./module.ts";

/**
 * Top-level field names that differ between a desired and a current state,
 * delegating to the module that owns the comparison for their shared kind.
 * Callers pair the two sides on a composite key that already includes the
 * kind; a pair whose kinds disagree describes unrelated resources and so has
 * no comparable fields.
 *
 * @param desired - Desired state for a resource.
 * @param current - Last-known current state for the same resource.
 * @returns The changed field names in the kind's deterministic order, or an
 *   empty array when the two kinds disagree.
 */
export function changedFieldsBetween(
	desired: ResourceDesiredState,
	current: ResourceCurrentState,
): ReadonlyArray<string> {
	switch (desired.kind) {
		case "developerProduct": {
			return current.kind === desired.kind
				? defaultKindRegistry.developerProduct.changedFieldsBetween(desired, current)
				: [];
		}
		case "gamePass": {
			return current.kind === desired.kind
				? defaultKindRegistry.gamePass.changedFieldsBetween(desired, current)
				: [];
		}
		case "place": {
			return current.kind === desired.kind
				? defaultKindRegistry.place.changedFieldsBetween(desired, current)
				: [];
		}
		case "universe": {
			return current.kind === desired.kind
				? defaultKindRegistry.universe.changedFieldsBetween(desired, current)
				: [];
		}
	}
}

/**
 * Run the kind's reconcilability invariant over a desired and current state.
 * Mirrors {@link changedFieldsBetween} on kind disagreement: unrelated
 * resources carry no invariant between them.
 *
 * @param desired - Desired state for a resource.
 * @param current - Last-known current state for the same resource.
 * @returns The kind's verdict, or `undefined` when the kind declares no
 *   invariant or the two kinds disagree.
 */
export function assertReconcilable(
	desired: ResourceDesiredState,
	current: ResourceCurrentState,
): Result<undefined, BuildDesiredError> | undefined {
	switch (desired.kind) {
		case "developerProduct": {
			return current.kind === desired.kind
				? defaultKindRegistry.developerProduct.assertReconcilable?.(current, desired)
				: undefined;
		}
		case "gamePass": {
			return current.kind === desired.kind
				? defaultKindRegistry.gamePass.assertReconcilable?.(current, desired)
				: undefined;
		}
		case "place": {
			return current.kind === desired.kind
				? defaultKindRegistry.place.assertReconcilable?.(current, desired)
				: undefined;
		}
		case "universe": {
			return current.kind === desired.kind
				? defaultKindRegistry.universe.assertReconcilable?.(current, desired)
				: undefined;
		}
	}
}

/**
 * Layer pre-I/O work onto a flat input by delegating to the module for the
 * kind the input declares.
 *
 * @param input - A flat pre-I/O input tagged with its kind.
 * @param io - The I/O surface kind modules read files through.
 * @returns The branded desired state, or the kind's build failure.
 */
export async function normalizeInputAsync(
	input: ResourceDesiredInput,
	io: KindIo,
): Promise<Result<ResourceDesiredState, BuildDesiredError>> {
	switch (input.kind) {
		case "developerProduct": {
			return defaultKindRegistry.developerProduct.normalize(input, io);
		}
		case "gamePass": {
			return defaultKindRegistry.gamePass.normalize(input, io);
		}
		case "place": {
			return defaultKindRegistry.place.normalize(input, io);
		}
		case "universe": {
			return defaultKindRegistry.universe.normalize(input, io);
		}
	}
}

/**
 * Project a resolved config through every kind module's `flatten`, in
 * registry declaration order.
 *
 * @param config - The resolved, environment-projected config.
 * @returns Every kind's flat pre-I/O inputs, concatenated.
 */
export function flattenAllKinds(config: ResolvedConfig): ReadonlyArray<ResourceDesiredInput> {
	return [
		...defaultKindRegistry.developerProduct.flatten(config),
		...defaultKindRegistry.gamePass.flatten(config),
		...defaultKindRegistry.place.flatten(config),
		...defaultKindRegistry.universe.flatten(config),
	];
}
