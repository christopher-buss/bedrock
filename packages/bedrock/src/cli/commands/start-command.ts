import type { Result } from "@bedrock-rbx/ocale";

import type {
	loadProjectAsync as defaultLoadProject,
	LoadedProject,
} from "../../shell/load-config.ts";
import { type CommonOptions, loadOptionsFor, parseCommonOptions } from "../parse-options.ts";
import { type ClackPort, renderDeployError, renderParseError } from "../render.ts";

/** What a command has in hand once its flags and project have resolved. */
export interface CommandStart {
	/** The validated config and what its `plugins` entries declared. */
	readonly loaded: LoadedProject;
	/** The validated common flags. */
	readonly parsed: CommonOptions;
}

/** What opening a command needs: somewhere to report, and a loader. */
interface StartCommandDeps {
	/** Output port the intro and any diagnostic is written to. */
	readonly clack: ClackPort;
	/**
	 * Subcommand name, used for the `bedrock <name>` / `<name> failed` lines.
	 */
	readonly command: string;
	/** Project loader the command resolved. */
	readonly loadProject: typeof defaultLoadProject;
}

/**
 * Open a command: announce it, validate the flags every subcommand shares,
 * and load the project once. A bad flag, or a config that will not load, is
 * rendered and closed out under the command's own label, so a caller only
 * has to turn the `Err` into an exit code.
 *
 * @param deps - Where to report, what to call the command, and the loader.
 * @param rawOptions - The options object sade hands the action callback.
 * @returns The validated flags and loaded project, or `Err` once the
 * reason has been rendered.
 */
export async function startCommandAsync(
	deps: StartCommandDeps,
	rawOptions: Readonly<Record<string, unknown>>,
): Promise<Result<CommandStart, void>> {
	deps.clack.intro(`bedrock ${deps.command}`);

	const parsed = parseCommonOptions(rawOptions);
	if (!parsed.success) {
		renderParseError(parsed.err, deps.clack);
		deps.clack.cancel(`${deps.command} failed`);
		return { err: undefined, success: false };
	}

	const loaded = await deps.loadProject(loadOptionsFor(parsed.data));
	if (!loaded.success) {
		renderDeployError({ cause: loaded.err, kind: "configLoadFailed" }, deps.clack);
		deps.clack.cancel(`${deps.command} failed`);
		return { err: undefined, success: false };
	}

	return { data: { loaded: loaded.data, parsed: parsed.data }, success: true };
}
