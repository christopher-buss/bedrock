import type { ImportDeclaration, ImportKind } from "../core/import-current.ts";
import { sha256HexAsync } from "../core/kinds/hash.ts";
import type { ResourceLiveState } from "../core/live-state.ts";
import type { ResourceDesiredState } from "../core/resources.ts";
import type { ResourceDriver } from "../ports/resource-driver.ts";
import { asSha256Hex, type Sha256Hex } from "../types/ids.ts";

/**
 * Hash the stored icon of an item an import declares, so a local file that
 * matches it needs no icon baseline. Nothing is downloaded when the
 * declaration already trusts the local file or the entry has no icon.
 *
 * @template K - Kind of the item.
 * @param driver - The Kind's Driver.
 * @param seen - The declaration, the Key's Desired state and the Live state.
 * @param seen.declaration - The import being recorded.
 * @param seen.desired - Desired state of the importing Key.
 * @param seen.live - Live state read from Roblox.
 * @returns The hash, or `undefined` when there is no icon to compare or it
 *   cannot be downloaded.
 */
export async function storedIconHashAsync<K extends ImportKind>(
	driver: ResourceDriver<K> | undefined,
	{
		declaration,
		desired,
		live,
	}: {
		readonly declaration: ImportDeclaration;
		readonly desired: Extract<ResourceDesiredState, { readonly kind: ImportKind }>;
		readonly live: ResourceLiveState<K>;
	},
): Promise<Sha256Hex | undefined> {
	if (
		declaration.acceptLocalIcon ||
		desired.icon === undefined ||
		driver?.readIcon === undefined
	) {
		return undefined;
	}

	const stored = await driver.readIcon(live);
	if (!stored.success || stored.data === undefined) {
		return undefined;
	}

	return asSha256Hex(await sha256HexAsync(stored.data));
}
