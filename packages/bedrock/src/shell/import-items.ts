import type { Credential, Result } from "@bedrock-rbx/ocale";

import { basename } from "node:path";

import type { EditOutcome } from "../core/config-editor/edit-config.ts";
import type { ImportLink } from "../core/import-links.ts";
import type {
	ImportItem,
	ImportPlanInput,
	ImportRefusal,
	ImportSelection,
	ImportTarget,
} from "../core/import-plan-types.ts";
import { planImport } from "../core/import-plan.ts";
import type { PluginRegistry } from "../core/plugin-registry.ts";
import type { Config } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { downloadIconsAsync, type IconFallback } from "./import-icons.ts";
import { createEnvironmentStateReader } from "./read-environment-state.ts";
import { type ImportLive, readLiveAsync } from "./read-import-live.ts";
import { importRegistry, type ImportRegistryError, readLinkLiveAsync } from "./read-link-live.ts";
import type { LiveCheckError } from "./read-live-state.ts";

/** The items the user chose in the picker. */
export interface ImportChoice {
	/** Untracked items to import. */
	readonly selections: ReadonlyArray<ImportSelection>;
	/** Tracked items to stop tracking. */
	readonly untrack: ReadonlyArray<ImportTarget>;
}

/** The user cancelled the picker; nothing was written. */
export interface ImportCancelled {
	/** Literal discriminator for narrowing. */
	readonly kind: "cancelled";
}

/**
 * Plans the links of keyed selections in every other Environment, for the
 * link screens.
 */
export type PlanImportLinks = (
	selections: ReadonlyArray<ImportSelection>,
) => ReadonlyArray<ImportLink>;

/** What {@link importItemsAsync} reads and writes. */
export interface ImportItemsOptions {
	/**
	 * Asks which live items to import, how to link them in the other
	 * Environments and which to stop tracking. When set, every live item of
	 * every Environment is listed and `selections` is ignored. Runs before
	 * any write.
	 */
	readonly choose?:
		| ((
				items: ReadonlyArray<ImportItem>,
				planLinks: PlanImportLinks,
		  ) => Promise<Result<ImportChoice, ImportCancelled>>)
		| undefined;
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
	/**
	 * How `selections` link in the other Environments when there is no
	 * `choose`: `auto` reads the other Environments and links each to its
	 * suggested same-name item, `none` (the default) reads no other
	 * Environment and so links nothing.
	 */
	readonly link?: "auto" | "none" | undefined;
	/** Read-capable Drivers of the other Environments; built when absent. */
	readonly linkRegistries?: Readonly<Record<string, DriverRegistry>> | undefined;
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
	/** The items to import when there is no `choose`. */
	readonly selections?: ReadonlyArray<ImportSelection> | undefined;
	/** Reads State; the config's backend when absent. Never written. */
	readonly statePort?: StatePort | undefined;
	/** Writes a downloaded icon or the edited config file. */
	readonly writeFile: (path: string, contents: string | Uint8Array) => Promise<void>;
}

/** What {@link importItemsAsync} did. */
export interface ImportItemsOutcome {
	/** Whether the config file was written. */
	readonly configWritten: boolean;
	/** One outcome per config edit, with paste text for the unwritten ones. */
	readonly edits: ReadonlyArray<EditOutcome>;
	/** Items whose icon file the user must supply. */
	readonly iconFallbacks: ReadonlyArray<IconFallback>;
	/** How each imported Key links in each other Environment. */
	readonly links: ReadonlyArray<ImportLink>;
	/** Selections that cannot be imported. */
	readonly refused: ReadonlyArray<ImportRefusal>;
	/** Environments whose State could not be read. */
	readonly unreadStates: ReadonlyArray<string>;
}

/** Why an import stopped before it wrote anything. */
export type ImportItemsError = ImportCancelled | ImportRegistryError | LiveCheckError;

const NOT_EDITABLE = "";

/** What was read before the choice. */
interface ImportSource {
	readonly input: ImportPlanInput;
	readonly live: ImportLive;
	readonly registry: DriverRegistry;
	readonly unreadStates: ReadonlyArray<string>;
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
	const source = await readSourceAsync(options);
	if (!source.success) {
		return source;
	}

	const { items } = planImport(source.data.input);
	const choice = await chooseAsync(options, { input: source.data.input, items });
	if (!choice.success) {
		return choice;
	}

	return {
		data: await writeChoiceAsync(options, { choice: choice.data, items, source: source.data }),
		success: true,
	};
}

async function writeEditsAsync(
	options: ImportItemsOptions,
	edits: ReturnType<typeof planImport>["edits"],
): Promise<Pick<ImportItemsOutcome, "configWritten" | "edits">> {
	const { configFile } = options;
	const editable = configFile !== undefined && basename(configFile) !== "package.json";
	const fileName = editable ? configFile : NOT_EDITABLE;
	const text = editable ? await options.readTextFile(configFile) : NOT_EDITABLE;
	// Loaded here so other commands do not load the editor's parsers at startup.
	const { editConfigText } = await import("../core/config-editor/edit-config.ts");
	const result = editConfigText({ edits, fileName, text });
	const configWritten = result.outcomes.some(({ status }) => status === "written");
	if (configWritten) {
		await options.writeFile(fileName, result.text);
	}

	return { configWritten, edits: result.outcomes };
}

async function writeChoiceAsync(
	options: ImportItemsOptions,
	{
		choice,
		items,
		source,
	}: {
		readonly choice: ImportChoice;
		readonly items: ReadonlyArray<ImportItem>;
		readonly source: ImportSource;
	},
): Promise<ImportItemsOutcome> {
	const icons = await downloadIconsAsync(options, {
		...source,
		items,
		selections: choice.selections,
	});
	const plan = planImport({
		...source.input,
		selections: icons.selections,
		untrack: choice.untrack,
	});
	const edited = await writeEditsAsync(options, plan.edits);
	return {
		...edited,
		iconFallbacks: icons.fallbacks,
		links: plan.links,
		refused: plan.refused,
		unreadStates: source.unreadStates,
	};
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

async function readOthersAsync(options: ImportItemsOptions): ReturnType<typeof readLinkLiveAsync> {
	return options.choose !== undefined || options.link === "auto"
		? readLinkLiveAsync(options, options.linkRegistries)
		: { data: {}, success: true };
}

async function readSourceAsync(
	options: ImportItemsOptions,
): Promise<Result<ImportSource, ImportItemsError>> {
	const registry = importRegistry(options, {
		environment: options.environment,
		registry: options.registry,
	});
	if (!registry.success) {
		return registry;
	}

	const live = await readLiveAsync(registry.data, {
		listAll: options.choose !== undefined,
		selections: options.selections ?? [],
	});
	if (!live.success) {
		return live;
	}

	const linkLive = await readOthersAsync(options);
	if (!linkLive.success) {
		return linkLive;
	}

	const { states, unreadStates } = await readStatesAsync(options);
	const { config, environment } = options;
	const input = { config, environment, linkLive: linkLive.data, live: live.data, states };
	return {
		data: { input, live: live.data, registry: registry.data, unreadStates },
		success: true,
	};
}

function autoLinked(
	input: ImportPlanInput,
	selections: ReadonlyArray<ImportSelection>,
): ReadonlyArray<ImportSelection> {
	return selections.map((selection) => {
		const { links } = planImport({ ...input, selections: [selection] });
		const suggested = links.flatMap(({ environment, suggested: linked }) => {
			return linked === undefined ? [] : [[environment, linked] as const];
		});
		return { ...selection, links: Object.fromEntries(suggested) };
	});
}

async function chooseAsync(
	options: ImportItemsOptions,
	{
		input,
		items,
	}: { readonly input: ImportPlanInput; readonly items: ReadonlyArray<ImportItem> },
): Promise<Result<ImportChoice, ImportCancelled>> {
	if (options.choose !== undefined) {
		return options.choose(items, (selections) => planImport({ ...input, selections }).links);
	}

	const selections = autoLinked(input, options.selections ?? []);
	return { data: { selections, untrack: [] }, success: true };
}
