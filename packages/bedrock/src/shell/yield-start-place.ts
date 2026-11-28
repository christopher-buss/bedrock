import type { Result } from "@bedrock-rbx/ocale";

import type { ResolvedConfig } from "../core/schema.ts";
import { contestedStartPlaceFields, yieldStartPlaceFields } from "../core/start-place-yield.ts";
import type { StartPlaceFieldSkippedEvent } from "../ports/progress-port.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import { asRobloxAssetId } from "../types/ids.ts";
import type { LiveCheckError } from "./read-live-state.ts";

/** The config a run deploys once the universe wins on its start place. */
export interface YieldedStartPlace {
	/** The config with the contested fields dropped from the start place. */
	readonly config: ResolvedConfig;
	/** One event per start place field the run does not write. */
	readonly skipped: ReadonlyArray<StartPlaceFieldSkippedEvent>;
}

/**
 * Let the universe win on its start place. When the universe and a place
 * both declare a field the universe sets on its start place, read the live
 * start place and drop that field from the place it names. A config without
 * such a field, or a universe Driver that cannot read, reads nothing.
 *
 * @param inputs - The resolved config, Environment, and universe Driver.
 * @returns The config the run deploys and the fields it skipped, or why the
 *   universe read failed.
 */
export async function yieldStartPlaceAsync({
	config,
	environment,
	universe: driver,
}: {
	readonly config: ResolvedConfig;
	readonly environment: string;
	readonly universe: ResourceDriver<"universe"> | undefined;
}): Promise<Result<YieldedStartPlace, LiveCheckError>> {
	const { universe } = config;
	if (universe === undefined || contestedStartPlaceFields(config).length === 0) {
		return { data: { config, skipped: [] }, success: true };
	}

	const live = await driver?.read?.(asRobloxAssetId(universe.universeId));
	if (live?.success === false) {
		return {
			err: { cause: live.err, kind: "liveCheckFailed", resourceKind: "universe" },
			success: false,
		};
	}

	const startPlaceId = live?.data?.outputs.rootPlaceId;
	if (startPlaceId === undefined) {
		return { data: { config, skipped: [] }, success: true };
	}

	const yielded = yieldStartPlaceFields(config, startPlaceId);
	return {
		data: {
			config: yielded.config,
			skipped: yielded.skipped.map(({ key, field }) => {
				return { key, environment, field, kind: "startPlaceFieldSkipped" };
			}),
		},
		success: true,
	};
}
