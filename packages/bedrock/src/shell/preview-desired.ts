import type { Result } from "@bedrock-rbx/ocale";

import { flattenConfig, type RetiredInput } from "../core/flatten.ts";
import type { ResourceDesiredState } from "../core/resources.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import { buildDesired, type BuildDesiredError } from "./build-desired.ts";
import type { LiveCheckError } from "./read-live-state.ts";
import { type YieldedStartPlace, yieldStartPlaceAsync } from "./yield-start-place.ts";

/**
 * The Desired state a preview diffs, built from the config its Deploy would
 * run.
 */
export interface PreviewDesired extends YieldedStartPlace {
	/** The Desired state built from `config`. */
	readonly desired: ReadonlyArray<ResourceDesiredState | RetiredInput>;
}

/**
 * Build the Desired state a Deploy would apply, after the universe wins on
 * its start place.
 *
 * @param inputs - The resolved config, Environment, file reader, and universe
 *   Driver.
 * @returns The yielded config with its Desired state, or why either failed.
 */
export async function buildPreviewDesiredAsync({
	config,
	environment,
	readFile,
	universe,
}: {
	readonly config: ResolvedConfig;
	readonly environment: string;
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly universe: ResourceDriver<"universe"> | undefined;
}): Promise<
	Result<
		PreviewDesired,
		LiveCheckError | { readonly cause: BuildDesiredError; readonly kind: "buildDesiredFailed" }
	>
> {
	const yielded = await yieldStartPlaceAsync({ config, environment, universe });
	if (!yielded.success) {
		return yielded;
	}

	const desired = await buildDesired({
		readFile,
		resources: flattenConfig(yielded.data.config),
	});
	return desired.success
		? { data: { ...yielded.data, desired: desired.data }, success: true }
		: { err: { cause: desired.err, kind: "buildDesiredFailed" }, success: false };
}
