import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";
import type { AssetsClient } from "@bedrock-rbx/ocale/assets";

import type { ResourceLiveState } from "../core/live-state.ts";
import type { ResourceKind } from "../core/resources.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import type { RobloxAssetId } from "../types/ids.ts";

/**
 * Give a Driver `readIcon` when it has an asset delivery client.
 *
 * @template K - Kind read by the Driver.
 * @param assets - Asset delivery client, if the Driver was given one.
 * @param iconOf - Reads the stored icon ID off a live item.
 * @returns `readIcon`, or nothing without a client.
 */
export function iconReader<K extends ResourceKind>(
	assets: AssetsClient | undefined,
	iconOf: (live: ResourceLiveState<K>) => RobloxAssetId | undefined,
): Pick<ResourceDriver<K>, "readIcon"> {
	if (assets === undefined) {
		return {};
	}

	const client = assets;
	async function readIconAsync(
		live: ResourceLiveState<K>,
	): Promise<Result<Uint8Array | undefined, OpenCloudError>> {
		return downloadIconAsync(client, iconOf(live));
	}

	return { readIcon: readIconAsync };
}

async function downloadIconAsync(
	assets: AssetsClient,
	assetId: RobloxAssetId | undefined,
): Promise<Result<Uint8Array | undefined, OpenCloudError>> {
	if (assetId === undefined) {
		return { data: undefined, success: true };
	}

	return assets.download({ assetId });
}
