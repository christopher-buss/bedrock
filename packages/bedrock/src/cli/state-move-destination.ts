import type { Result } from "@bedrock-rbx/ocale";

import type { ConfigValidationIssue } from "../core/config-error.ts";
import type { PluginRegistry } from "../core/plugin-registry.ts";
import { parseStateConfig, type StateConfig } from "../core/schema.ts";
import type { StateMoveOptions } from "./parse-state-move-options.ts";

/** Why the flags did not describe a destination that could be reached. */
export type StateMoveDestinationError =
	| {
			/** **Backend** names the flags could have named. */
			readonly available: ReadonlyArray<string>;
			/** Literal discriminator for narrowing. */
			readonly kind: "noDestination";
	  }
	| {
			/** **Backend** names the flags could have named. */
			readonly available: ReadonlyArray<string>;
			/** Literal discriminator for narrowing. */
			readonly kind: "unknownBackend";
			/** The name the flags did name. */
			readonly received: string;
	  }
	| {
			/** Every problem, attributed to the coordinate carrying it. */
			readonly issues: ReadonlyArray<ConfigValidationIssue>;
			/** Literal discriminator for narrowing. */
			readonly kind: "invalidCoordinates";
	  };

/** The **Backend** core ships, which is a destination without a plugin. */
const BUILTIN_BACKEND = "gist";

/**
 * Name every **Backend** a move can land on: the builtin, plus whatever
 * the loaded plugins claimed.
 *
 * @param plugins - What the loaded plugins declared.
 * @returns The names, in the order they read to someone picking one.
 */
export function availableBackends(plugins: PluginRegistry): ReadonlyArray<string> {
	return [BUILTIN_BACKEND, ...plugins.stateBackends.keys()].sort();
}

/**
 * Assemble the `state` block the flags describe and check it against the
 * **Backend** it names.
 *
 * Checking here rather than at the first write is what makes a mistyped
 * coordinate a message about the flag, instead of a request against a
 * store nothing is stored in.
 *
 * @param options - The destination the flags named and its coordinates.
 * @param plugins - What the loaded plugins declared.
 * @returns The block to move onto, or why the flags do not describe one.
 */
export function resolveMoveDestination(
	options: StateMoveOptions,
	plugins: PluginRegistry,
): Result<StateConfig, StateMoveDestinationError> {
	const available = availableBackends(plugins);
	if (options.to === undefined) {
		return { err: { available, kind: "noDestination" }, success: false };
	}

	if (!available.includes(options.to)) {
		return {
			err: { available, kind: "unknownBackend", received: options.to },
			success: false,
		};
	}

	const parsed = parseStateConfig({ ...options.coordinates, backend: options.to }, plugins);
	if (parsed.success) {
		return parsed;
	}

	return { err: { issues: parsed.err, kind: "invalidCoordinates" }, success: false };
}
