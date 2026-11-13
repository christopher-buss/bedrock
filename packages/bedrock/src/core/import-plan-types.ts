import type { RobloxAssetId } from "../types/ids.ts";
import type { ConfigEdit } from "./config-editor/edit-config.ts";
import type { ImportKind } from "./import-current.ts";
import type { ImportLink } from "./import-links.ts";
import type { LiveSnapshot } from "./live-state.ts";
import type { Config } from "./schema.ts";
import type { BedrockState } from "./state.ts";

/**
 * Kind of a live item an import lists: a Kind whose overlay entries accept
 * `importId`, or a place, which an overlay adopts by `placeId`.
 *
 * @since unreleased
 */
export type ImportItemKind = "place" | ImportKind;

/**
 * Where the icon file of a selected item comes from.
 *
 * - `download`: the stored icon, downloaded to `path`.
 * - `userFile`: a file the user supplies at `path`. The import then declares
 *   `iconBaseline: "accept-local-file"`, because the file is the user's
 *   claim, not a verified copy.
 *
 * @since unreleased
 */
export interface ImportIcon {
	/** Repository path of the icon file. */
	readonly path: string;
	/** Who made the file. */
	readonly source: "download" | "userFile";
}

/**
 * One live item to import.
 *
 * @since unreleased
 */
export interface ImportSelection {
	/** Key to write instead of the suggested one. */
	readonly key?: string;
	/**
	 * The item's icon file. Defaults to the stored icon downloaded to
	 * `assets/<collection>/<key>.png`.
	 */
	readonly icon?: ImportIcon;
	/** Kind of the item. */
	readonly kind: ImportItemKind;
	/**
	 * The live item each other Environment links the Key to, by Environment
	 * name. Each writes an `importId` line (`placeId` for a place) on that
	 * Environment's overlay; an Environment left out creates the item on its
	 * next deploy.
	 */
	readonly links?: Readonly<Record<string, RobloxAssetId>>;
	/** Roblox ID of the item. */
	readonly robloxId: RobloxAssetId;
}

/**
 * One live item, named by Kind and Roblox ID.
 *
 * @since unreleased
 */
export interface ImportTarget {
	/** Kind of the item. */
	readonly kind: ImportItemKind;
	/** Roblox ID of the item. */
	readonly robloxId: RobloxAssetId;
}

/**
 * Input to `planImport`.
 *
 * @since unreleased
 */
export interface ImportPlanInput {
	/** The project config, as authored. */
	readonly config: Config;
	/** The Environment whose live items are imported. */
	readonly environment: string;
	/**
	 * Live lists of the other Environments' universes, by Environment name.
	 * Selections are linked only in these Environments.
	 */
	readonly linkLive?: Readonly<Record<string, LiveSnapshot>>;
	/** Live lists of the source Environment's universe. */
	readonly live: LiveSnapshot;
	/** The items to import. */
	readonly selections?: ReadonlyArray<ImportSelection>;
	/**
	 * Saved State per Environment. A missing Environment counts as holding
	 * no State.
	 */
	readonly states?: Readonly<Record<string, BedrockState | undefined>>;
	/**
	 * Tracked items to stop tracking. Each writes `retired: "untrack"` on the
	 * root entry of the Key that tracks it; an item no Key tracks is skipped.
	 */
	readonly untrack?: ReadonlyArray<ImportTarget>;
}

/**
 * The stored icon of a live item, and where to download it.
 *
 * @since unreleased
 */
export interface ImportItemIcon {
	/** Roblox asset ID of the stored icon. */
	readonly assetId: RobloxAssetId;
	/** Suggested repository path for the downloaded file. */
	readonly path: string;
}

/**
 * Why a selected item cannot be imported.
 *
 * @since unreleased
 */
export type ImportRefusalReason =
	| "defaultImage"
	| "invalidKey"
	| "keyTaken"
	| "linkUnavailable"
	| "notLive"
	| "onlyOneEnvironment"
	| "placeNotLinked"
	| "placeholder"
	| "tracked";

/**
 * A selected item that cannot be imported.
 *
 * @since unreleased
 */
export interface ImportRefusal {
	/** Kind of the selection. */
	readonly kind: ImportItemKind;
	/** What to tell the user. */
	readonly message: string;
	/** Why the item cannot be imported. */
	readonly reason: ImportRefusalReason;
	/** Roblox ID of the selection. */
	readonly robloxId: RobloxAssetId;
}

/**
 * One live item of the source Environment.
 *
 * @since unreleased
 */
export interface ImportItem {
	/** Suggested Key, or the Key that tracks the item. */
	readonly key: string;
	/** Name shown on Roblox. */
	readonly name: string;
	/**
	 * The stored icon, or `undefined` when the item uses the Roblox default
	 * image.
	 */
	readonly icon: ImportItemIcon | undefined;
	/** Kind of the item. */
	readonly kind: ImportItemKind;
	/**
	 * `true` when the source Environment redacts the item: once imported,
	 * its next deploy there replaces the live name, description, icon and
	 * price with placeholders. Absent otherwise.
	 */
	readonly redacted?: true;
	/** Roblox ID of the item. */
	readonly robloxId: RobloxAssetId;
	/** Set on the universe's root place. */
	readonly root?: true;
	/** Key that already tracks the item in the source Environment. */
	readonly trackedBy: string | undefined;
	/**
	 * Why the item cannot be imported yet, when it cannot: it exists only in
	 * the source Environment, so its next deploy would create it in every
	 * other Environment. Absent when the item can be imported.
	 */
	readonly unavailable?: ImportRefusal;
}

/**
 * What `planImport` found.
 *
 * @since unreleased
 */
export interface ImportPlan {
	/** Config changes for the importable selections, in selection order. */
	readonly edits: ReadonlyArray<ConfigEdit>;
	/**
	 * Every live item, in Kind order: game passes, products, badges, places.
	 */
	readonly items: ReadonlyArray<ImportItem>;
	/**
	 * How each importable selection links in each other Environment of
	 * `linkLive`: grouped by Environment in config order, then in selection
	 * order.
	 */
	readonly links: ReadonlyArray<ImportLink>;
	/** Selections that cannot be imported, in selection order. */
	readonly refused: ReadonlyArray<ImportRefusal>;
}
