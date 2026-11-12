import type { Credential, OpenCloudError, Result } from "@bedrock-rbx/ocale";

import { readFile as nodeReadFile } from "node:fs/promises";
import { basename } from "node:path";

import { editConfigText, type EditOutcome } from "../core/config-editor/edit-config.ts";
import type { ImportKind } from "../core/import-current.ts";
import {
	type ImportIcon,
	type ImportItem,
	type ImportPlanInput,
	type ImportRefusal,
	type ImportSelection,
	planImport,
} from "../core/import-plan.ts";
import type { PluginRegistry } from "../core/plugin-registry.ts";
import type { Config } from "../core/schema.ts";
import { selectEnvironment, type SelectEnvironmentError } from "../core/select-environment.ts";
import type { BedrockState } from "../core/state.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import type { RobloxAssetId } from "../types/ids.ts";
import { buildDefaultRegistry, type RegistryConfigError } from "./build-default-registry.ts";
import type { MissingCredentialError } from "./build-state-port.ts";
import { createEnvironmentStateReader } from "./read-environment-state.ts";
import { type ImportLive, type LiveItems, readLiveAsync } from "./read-import-live.ts";
import type { LiveCheckError } from "./read-live-state.ts";

/** What {@link importItemsAsync} reads and writes. */
export interface ImportItemsOptions {
	/** The project config, as authored. */
	readonly config: Config;
	/**
	 * Path of the config file to edit, or `undefined` when it is not known;
	 * the entries are then returned as paste text.
	 */
	readonly configFile: string | undefined;
	/** Open Cloud authentication; `BEDROCK_API_KEY` when absent. */
	readonly credential?: Credential | undefined;
	/** The Environment whose live items are imported. */
	readonly environment: string;
	/** Reads an environment variable. */
	readonly getEnv: (name: string) => string | undefined;
	/** What the loaded plugins declared, for plugin State backends. */
	readonly plugins?: PluginRegistry | undefined;
	/**
	 * Reads a file for the default Drivers; `node:fs/promises.readFile` when
	 * absent.
	 */
	readonly readFile?: ((path: string) => Promise<Uint8Array>) | undefined;
	/** Reads the config file's text. */
	readonly readTextFile: (path: string) => Promise<string>;
	/** Read-capable Drivers of the source Environment; built when absent. */
	readonly registry?: DriverRegistry | undefined;
	/** The items to import. */
	readonly selections: ReadonlyArray<ImportSelection>;
	/** Reads State; the config's backend when absent. Never written. */
	readonly statePort?: StatePort | undefined;
	/** Writes a downloaded icon or the edited config file. */
	readonly writeFile: (path: string, contents: string | Uint8Array) => Promise<void>;
}

/** An item whose stored icon could not be downloaded. */
export interface IconFallback {
	/** Key of the entry. */
	readonly key: string;
	/** Why the download failed, when Roblox said. */
	readonly cause: OpenCloudError | undefined;
	/** Kind of the item. */
	readonly kind: ImportKind;
	/** Where the user must put the icon file. */
	readonly path: string;
	/** Roblox ID of the item. */
	readonly robloxId: RobloxAssetId;
}

/** What {@link importItemsAsync} did. */
export interface ImportItemsOutcome {
	/** Whether the config file was written. */
	readonly configWritten: boolean;
	/** One outcome per config edit, with paste text for the unwritten ones. */
	readonly edits: ReadonlyArray<EditOutcome>;
	/** Items whose icon file the user must supply. */
	readonly iconFallbacks: ReadonlyArray<IconFallback>;
	/** Selections that cannot be imported. */
	readonly refused: ReadonlyArray<ImportRefusal>;
	/** Environments whose State could not be read. */
	readonly unreadStates: ReadonlyArray<string>;
}

/** Why an import stopped before it wrote anything. */
export type ImportItemsError =
	| LiveCheckError
	| MissingCredentialError
	| RegistryConfigError
	| SelectEnvironmentError;

const NOT_EDITABLE = "";

interface DownloadedIcon extends ImportIcon {
	readonly cause: OpenCloudError | undefined;
	readonly item: ImportItem;
}

/**
 * Import live items of one Environment into config: list them, download
 * their stored icons, and write the root entries and `importId` lines.
 * State is read to find tracked items and is never written.
 *
 * @param options - Config, Environment, selections and I/O.
 * @returns What was written and what was refused, or why nothing was.
 */
export async function importItemsAsync(
	options: ImportItemsOptions,
): Promise<Result<ImportItemsOutcome, ImportItemsError>> {
	const registry = registryFor(options);
	if (!registry.success) {
		return registry;
	}

	const live = await readLiveAsync(registry.data, options.selections);
	if (!live.success) {
		return live;
	}

	const { states, unreadStates } = await readStatesAsync(options);
	const input: ImportPlanInput = {
		config: options.config,
		environment: options.environment,
		live: live.data,
		states,
	};
	const icons = await downloadIconsAsync(options, {
		items: planImport(input).items,
		live: live.data,
		registry: registry.data,
	});
	const plan = planImport({ ...input, selections: icons.selections });
	const edited = await writeEditsAsync(options, plan.edits);
	return {
		data: { ...edited, iconFallbacks: icons.fallbacks, refused: plan.refused, unreadStates },
		success: true,
	};
}

function registryFor(options: ImportItemsOptions): Result<DriverRegistry, ImportItemsError> {
	const resolved = selectEnvironment(options.config, options.environment);
	if (!resolved.success) {
		return resolved;
	}

	return options.registry === undefined
		? buildDefaultRegistry({
				...options,
				config: resolved.data,
				readFile: options.readFile ?? nodeReadFile,
			})
		: { data: options.registry, success: true };
}

async function readStatesAsync(options: ImportItemsOptions): Promise<{
	readonly states: Readonly<Record<string, BedrockState | undefined>>;
	readonly unreadStates: ReadonlyArray<string>;
}> {
	const port = options.statePort;
	const read =
		port === undefined
			? createEnvironmentStateReader({
					config: options.config,
					getEnv: options.getEnv,
					plugins: options.plugins ?? { stateBackends: new Map() },
				})
			: async (environment: string) => port.read(environment);
	const states: Record<string, BedrockState | undefined> = {};
	const unreadStates: Array<string> = [];
	for (const environment of Object.keys(options.config.environments)) {
		const record = await read(environment);
		if (record.success) {
			states[environment] = record.data.state;
		} else {
			unreadStates.push(environment);
		}
	}

	return { states, unreadStates };
}

function selectionKey({ kind, robloxId }: Pick<ImportSelection, "kind" | "robloxId">): string {
	return `${kind}:${robloxId}`;
}

function downloadTargets(
	selections: ReadonlyArray<ImportSelection>,
	items: ReadonlyArray<ImportItem>,
): ReadonlyMap<string, ImportItem> {
	const selected = new Set(selections.map(selectionKey));
	return new Map(
		items
			.filter((item) => item.trackedBy === undefined && selected.has(selectionKey(item)))
			.map((item) => [selectionKey(item), item]),
	);
}

async function downloadKindAsync<K extends ImportKind>(
	options: ImportItemsOptions,
	{
		driver,
		kind,
		live,
		targets,
	}: {
		readonly driver: ResourceDriver<K>;
		readonly kind: K;
		readonly live: LiveItems<K>;
		readonly targets: ReadonlyMap<string, ImportItem>;
	},
): Promise<ReadonlyArray<readonly [string, DownloadedIcon]>> {
	const icons: Array<readonly [string, DownloadedIcon]> = [];
	for (const [robloxId, state] of live) {
		const key = selectionKey({ kind, robloxId });
		const item = targets.get(key);
		if (item?.icon === undefined) {
			continue;
		}

		const { path } = item.icon;
		const stored = await driver.readIcon?.(state);
		if (stored?.success === true && stored.data !== undefined) {
			await options.writeFile(path, stored.data);
			icons.push([key, { cause: undefined, item, path, source: "download" }]);
		} else {
			const cause = stored?.success === false ? stored.err : undefined;
			icons.push([key, { cause, item, path, source: "userFile" }]);
		}
	}

	return icons;
}

async function downloadAllAsync(
	options: ImportItemsOptions,
	{
		live,
		registry,
		targets,
	}: {
		readonly live: ImportLive;
		readonly registry: DriverRegistry;
		readonly targets: ReadonlyMap<string, ImportItem>;
	},
): Promise<ReadonlyMap<string, DownloadedIcon>> {
	return new Map([
		...(await downloadKindAsync(options, {
			driver: registry.badge,
			kind: "badge",
			live: live.badge,
			targets,
		})),
		...(await downloadKindAsync(options, {
			driver: registry.developerProduct,
			kind: "developerProduct",
			live: live.developerProduct,
			targets,
		})),
		...(await downloadKindAsync(options, {
			driver: registry.gamePass,
			kind: "gamePass",
			live: live.gamePass,
			targets,
		})),
	]);
}

async function downloadIconsAsync(
	options: ImportItemsOptions,
	{
		items,
		live,
		registry,
	}: {
		readonly items: ReadonlyArray<ImportItem>;
		readonly live: ImportLive;
		readonly registry: DriverRegistry;
	},
): Promise<{
	readonly fallbacks: ReadonlyArray<IconFallback>;
	readonly selections: ReadonlyArray<ImportSelection>;
}> {
	const targets = downloadTargets(options.selections, items);
	const icons = await downloadAllAsync(options, { live, registry, targets });
	const fallbacks = [...icons.values()]
		.filter(({ source }) => source === "userFile")
		.map(({ cause, item: { key, kind, robloxId }, path }) => {
			return { key, cause, kind, path, robloxId };
		});
	const selections = options.selections.map((selection) => {
		const icon = icons.get(selectionKey(selection));
		return icon === undefined
			? selection
			: { ...selection, icon: { path: icon.path, source: icon.source } };
	});
	return { fallbacks, selections };
}

async function writeEditsAsync(
	options: ImportItemsOptions,
	edits: ReturnType<typeof planImport>["edits"],
): Promise<Pick<ImportItemsOutcome, "configWritten" | "edits">> {
	const { configFile } = options;
	const editable = configFile !== undefined && basename(configFile) !== "package.json";
	const fileName = editable ? configFile : NOT_EDITABLE;
	const text = editable ? await options.readTextFile(configFile) : NOT_EDITABLE;
	const result = editConfigText({ edits, fileName, text });
	const configWritten = result.outcomes.some(({ status }) => status === "written");
	if (configWritten) {
		await options.writeFile(fileName, result.text);
	}

	return { configWritten, edits: result.outcomes };
}
