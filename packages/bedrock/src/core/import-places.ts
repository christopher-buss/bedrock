import { asRobloxAssetId, type RobloxAssetId } from "../types/ids.ts";
import type { EditFields } from "./config-editor/edit-config.ts";
import { environmentPrefix, withoutPrefix } from "./environment-prefix.ts";
import type { LiveSnapshot, ResourceLiveState } from "./live-state.ts";
import type { Config } from "./schema.ts";

/**
 * Fields of the root entry an imported place writes: its live display name
 * without the source Environment's prefix, description and server size. No
 * `filePath`: the entry manages metadata only.
 *
 * @param live - Live state of the place.
 * @param prefix - Display-name prefix of the source Environment.
 * @returns Display name, description and server size to write.
 */
export function placeEntryFields(live: ResourceLiveState<"place">, prefix: string): EditFields {
	return {
		description: live.description ?? "",
		displayName: withoutPrefix(live.displayName ?? "", prefix),
		...(live.serverSize === undefined ? {} : { serverSize: live.serverSize }),
	};
}

/**
 * The fields another Environment deploys for an imported place: the root
 * entry, with `displayName` set to the name under that Environment's
 * display-name prefix.
 *
 * @param config - Config holding each Environment's prefix.
 * @param link - Source and linked Environments, and the imported item.
 * @returns The fields to compare with that Environment's live items.
 */
export function expectedPlaceFields(
	config: Config,
	{
		environment,
		source,
		subject,
	}: {
		readonly environment: string;
		readonly source: string;
		readonly subject: { readonly fields: EditFields; readonly name: string };
	},
): EditFields {
	const name = withoutPrefix(subject.name, environmentPrefix(config, source));
	return { ...subject.fields, displayName: environmentPrefix(config, environment) + name };
}

/**
 * Root place IDs of the universes in a snapshot.
 *
 * @param live - Live lists, with the universe when it was read.
 * @returns The IDs of the places each universe starts players in.
 */
export function rootPlaceIds(live: LiveSnapshot): ReadonlySet<RobloxAssetId> {
	const universes = [...(live.universe?.values() ?? [])];
	return new Set(universes.flatMap(({ outputs }) => outputs.rootPlaceId ?? []));
}

/**
 * Place IDs an Environment's overlay declares, with the Key of each.
 *
 * @param config - Config holding the overlays.
 * @param environment - Name of the Environment.
 * @returns The declaring Key per place ID.
 */
export function declaredPlaceIds(
	config: Config,
	environment: string,
): ReadonlyArray<readonly [RobloxAssetId, string]> {
	const overlay = config.environments[environment]?.places ?? {};
	return Object.entries(overlay).flatMap(([key, entry]) => {
		return "placeId" in entry ? [[asRobloxAssetId(entry.placeId), key] as const] : [];
	});
}

/**
 * The first other Environment a place selection does not link in. A place
 * entry needs a `placeId` in every Environment, so no deploy can create it.
 *
 * @param config - Config listing every Environment.
 * @param selection - Source Environment and the selected links.
 * @returns The Environment, or `undefined` when every one is linked.
 */
export function unlinkedEnvironment(
	config: Config,
	{
		environment,
		links,
	}: {
		readonly environment: string;
		readonly links: Readonly<Record<string, RobloxAssetId>> | undefined;
	},
): string | undefined {
	return Object.keys(config.environments).find((other) => {
		return other !== environment && links?.[other] === undefined;
	});
}
