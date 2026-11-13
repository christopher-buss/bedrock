import process from "node:process";

import type { ImportLink } from "../../core/import-links.ts";
import {
	importItemsAsync,
	type ImportItemsOptions,
	type ImportItemsOutcome,
} from "../../shell/import-items.ts";
import type { LoadedProject } from "../../shell/load-config.ts";
import { loadProjectAsync as defaultLoadProject } from "../../shell/load-config.ts";
import { chooseImportAsync, type ChooseImportInputs } from "../choose-import.ts";
import { createClackPort } from "../clack-port.ts";
import { buildEnvironmentReader } from "../credential-environment-overrides.ts";
import { createDefaultImportPromptPort, redactionWarning } from "../default-import-prompt-port.ts";
import { EXIT_ERROR, EXIT_OK } from "../exit-codes.ts";
import { nodeReadTextFileAsync, nodeWriteFileAsync } from "../fs-seams.ts";
import type { ImportPromptPort } from "../import-prompt-port.ts";
import type { ProgDeps } from "../index.ts";
import {
	type ImportOptions,
	type ParseImportError,
	parseImportOptions,
} from "../parse-import-options.ts";
import {
	type ClackPort,
	renderDeployError,
	renderParseError,
	type RenderPort,
	renderVerbose,
	withVerbosity,
} from "../render.ts";

const COMMAND = "import";

/** Exit status of a run the user cancelled; the outro says so. */
const CANCELLED = "cancelled";

/** The command's dependency slots, each resolved to a real default. */
interface ResolvedImport {
	readonly clack: ClackPort;
	readonly exit: (code: number) => void;
	readonly importItems: typeof importItemsAsync;
	readonly loadProject: typeof defaultLoadProject;
	readonly promptPort: ImportPromptPort;
	readonly readTextFile: (path: string) => Promise<string>;
	readonly writeFile: (path: string, contents: string | Uint8Array) => Promise<void>;
}

/** Where an import outcome is reported. */
interface OutcomeTarget {
	readonly clack: RenderPort;
	/** The source Environment. */
	readonly environment: string;
	/** The config file the entries go into. */
	readonly file: string | undefined;
}

/**
 * Build the sade action for `bedrock import`. Imports live items of one
 * **Environment** into config: it writes root entries, `importId` and
 * `placeId` lines, `retired: "untrack"` markers and downloaded icons, and
 * never writes State. With `--yes` it imports the items named by `--select`
 * and links them in the other Environments as `--link` says; without it, the
 * user picks items in a tree, links each Key in each other Environment and
 * confirms before anything is written.
 *
 * @param deps - Dependency overrides; missing slots are default-constructed
 *   from real implementations.
 * @returns An async sade action that returns once `deps.exit` was invoked.
 */
export function importCommand(
	deps: ProgDeps,
): (rawOptions: Readonly<Record<string, unknown>>) => Promise<void> {
	const resolved: ResolvedImport = {
		clack: deps.clack ?? createClackPort(),
		exit: deps.exit ?? ((code) => process.exit(code)),
		importItems: deps.importItems ?? importItemsAsync,
		loadProject: deps.loadProject ?? defaultLoadProject,
		promptPort: deps.importPromptPort ?? createDefaultImportPromptPort(),
		readTextFile: deps.readTextFile ?? nodeReadTextFileAsync,
		writeFile: nodeWriteFileAsync,
	};
	return async (rawOptions) => {
		const code = await runAsync(rawOptions, resolved);
		resolved.exit(code);
	};
}

function parseErrorLine(err: ParseImportError, clack: ClackPort): void {
	if (err.kind === "invalidSelection") {
		clack.logError(
			`--select "${err.received}" is not <kind>:<id>; the kind is game-pass, developer-product, badge or place, and the id is digits.`,
		);
		return;
	}

	renderParseError(err, clack);
}

function checkOptions(
	rawOptions: Readonly<Record<string, unknown>>,
	clack: ClackPort,
): ImportOptions | undefined {
	const parsed = parseImportOptions(rawOptions);
	if (!parsed.success) {
		parseErrorLine(parsed.err, clack);
		return undefined;
	}

	const { link, selections, yes } = parsed.data;
	if (!yes && link !== undefined) {
		clack.logError("--link needs --yes; the picker asks for each link instead.");
		return undefined;
	}

	if (!yes && selections.length > 0) {
		clack.logError(
			"--select needs --yes; without both, bedrock import shows a picker of the live items.",
		);
		return undefined;
	}

	if (yes && selections.length === 0) {
		renderParseError({ flag: "select", kind: "missingRequired" }, clack);
		return undefined;
	}

	return parsed.data;
}

function where(path: ReadonlyArray<string>): string {
	return path.length === 0 ? "the top level" : `"${path.join(".")}"`;
}

function linkLine({ key, candidates, environment, kind, linked }: ImportLink): string {
	const candidate = candidates.find(({ robloxId }) => robloxId === linked);
	if (candidate === undefined) {
		return `${kind}:${key} is not linked in "${environment}": the next deploy there creates it.`;
	}

	const fields = candidate.differences.map(({ field }) => field);
	const differs =
		fields.length === 0
			? ""
			: ` The next deploy there changes ${fields.join(", ")} to the config values.`;
	return `${kind}:${key} is linked in "${environment}" to id ${candidate.robloxId} "${candidate.name}".${differs}`;
}

function renderUnreadStates(outcome: ImportItemsOutcome, clack: RenderPort): void {
	for (const unread of outcome.unreadStates) {
		clack.logMessage(
			`The State of "${unread}" could not be read, so an item it tracks is not detected.`,
		);
	}
}

function renderOutcome(
	outcome: ImportItemsOutcome,
	{ clack, environment, file }: OutcomeTarget,
): void {
	renderUnreadStates(outcome, clack);
	for (const fallback of outcome.iconFallbacks) {
		clack.logMessage(
			`'${fallback.key}': the stored icon could not be downloaded. Put the icon file at ${fallback.path}; the entry declares iconBaseline: "accept-local-file".`,
		);
		renderVerbose(fallback.cause, clack);
	}

	for (const edit of outcome.edits) {
		if (edit.status === "notSafe") {
			clack.logMessage(
				`Paste this into ${where(edit.paste.path)} in ${file ?? "the config file"}:\n${edit.paste.text}`,
			);
		}
	}

	if (outcome.configWritten) {
		clack.logSuccess(`Wrote the imported entries to ${String(file)}.`);
	}

	if (outcome.redacted.length > 0) {
		clack.logMessage(redactionWarning(environment, outcome.redacted));
	}

	for (const link of outcome.links) {
		clack.logMessage(linkLine(link));
	}

	for (const refusal of outcome.refused) {
		clack.logError(refusal.message);
	}
}

function chooserOf(picker: ChooseImportInputs): NonNullable<ImportItemsOptions["choose"]> {
	return async (items, planLinks) => chooseImportAsync(picker, { items, planLinks });
}

async function importAsync(
	options: ImportOptions,
	{ loaded, resolved }: { readonly loaded: LoadedProject; readonly resolved: ResolvedImport },
): Promise<number | typeof CANCELLED> {
	const clack = withVerbosity(resolved.clack, options.verbose);
	const { environment, selections, yes } = options;
	const picker = { clack, environment, port: resolved.promptPort };
	const imported = await resolved.importItems({
		...(yes ? {} : { choose: chooserOf(picker) }),
		config: loaded.config,
		configFile: loaded.sourceFile,
		environment,
		getEnv: buildEnvironmentReader(options),
		link: options.link,
		plugins: loaded.plugins,
		readTextFile: resolved.readTextFile,
		selections,
		writeFile: resolved.writeFile,
	});
	if (!imported.success) {
		if (imported.err.kind === "cancelled") {
			return CANCELLED;
		}

		renderDeployError(imported.err, clack);
		return EXIT_ERROR;
	}

	renderOutcome(imported.data, { clack, environment, file: loaded.sourceFile });
	return imported.data.refused.length === 0 ? EXIT_OK : EXIT_ERROR;
}

async function loadAndImportAsync(
	rawOptions: Readonly<Record<string, unknown>>,
	resolved: ResolvedImport,
): Promise<number | typeof CANCELLED> {
	const options = checkOptions(rawOptions, resolved.clack);
	if (options === undefined) {
		return EXIT_ERROR;
	}

	const { configFile } = options;
	const loaded = await resolved.loadProject(
		configFile === undefined ? undefined : { configFile },
	);
	if (!loaded.success) {
		renderDeployError({ cause: loaded.err, kind: "configLoadFailed" }, resolved.clack);
		return EXIT_ERROR;
	}

	return importAsync(options, { loaded: loaded.data, resolved });
}

async function runAsync(
	rawOptions: Readonly<Record<string, unknown>>,
	resolved: ResolvedImport,
): Promise<number> {
	resolved.clack.intro(`bedrock ${COMMAND}`);
	const code = await loadAndImportAsync(rawOptions, resolved);
	if (code === CANCELLED) {
		resolved.clack.cancel(`${COMMAND} cancelled`);
		return EXIT_ERROR;
	}

	if (code === EXIT_OK) {
		resolved.clack.outro(`${COMMAND} succeeded`);
	} else {
		resolved.clack.cancel(`${COMMAND} failed`);
	}

	return code;
}
