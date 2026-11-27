import type { Result } from "@bedrock-rbx/ocale";

import type { ResolvedConfig } from "../core/schema.ts";
import { contestedStartPlaceFields, yieldStartPlaceFields } from "../core/start-place-yield.ts";
import type { ProgressPort } from "../ports/progress-port.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import { asRobloxAssetId } from "../types/ids.ts";
import type { DeployError } from "./deploy.ts";

/**
 * Let the universe win on its start place. When the universe and a place
 * both declare a field the universe sets on its start place, read the live
 * start place and drop that field from the place it names, with one
 * `startPlaceFieldSkipped` event per dropped field. A config without such a
 * field reads nothing.
 *
 * @param inputs - The resolved config, Environment, progress port, and Drivers.
 * @returns The config the run deploys, or why the universe read failed.
 */
export async function yieldStartPlaceAsync({
	config,
	environment,
	progress,
	registry,
}: {
	readonly config: ResolvedConfig;
	readonly environment: string;
	readonly progress: ProgressPort;
	readonly registry: DriverRegistry;
}): Promise<Result<ResolvedConfig, DeployError>> {
	const { universe } = config;
	if (universe === undefined || contestedStartPlaceFields(config).length === 0) {
		return { data: config, success: true };
	}

	const live = await registry.universe.read?.(asRobloxAssetId(universe.universeId));
	if (live?.success === false) {
		return {
			err: { cause: live.err, kind: "liveCheckFailed", resourceKind: "universe" },
			success: false,
		};
	}

	const startPlaceId = live?.data?.outputs.rootPlaceId;
	if (startPlaceId === undefined) {
		return { data: config, success: true };
	}

	const yielded = yieldStartPlaceFields(config, startPlaceId);
	for (const { key, field } of yielded.skipped) {
		progress.emit({ key, environment, field, kind: "startPlaceFieldSkipped" });
	}

	return { data: yielded.config, success: true };
}
