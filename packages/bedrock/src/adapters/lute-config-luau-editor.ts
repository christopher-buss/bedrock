import type { Result } from "@bedrock-rbx/ocale";

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import editorSource from "../luau/config-luau-editor.luau?raw";
import type {
	ConfigLuauEditor,
	ConfigLuauEditorError,
	ConfigLuauInspection,
} from "../ports/config-luau-editor.ts";
import { isEnoentError, LUAU_RUNTIME_HINT, resolveLuteBinary } from "./lute-runtime.ts";

const SENTINEL = "__BEDROCK_CONFIG_LUAU__";

const MINIMUM_LUTE_VERSION = "1.0.1-nightly.20261021";

/**
 * Build the default `ConfigLuauEditor` adapter, which runs a bundled Luau
 * script under the `lute` runtime. The script parses the source with
 * lute's `@std/syntax` and splices the alias into the text, so every other
 * key, comment, and whitespace stays as written. Reads `BEDROCK_LUTE_PATH`
 * on each call to pick the binary.
 *
 * @returns A `ConfigLuauEditor` that spawns `lute run` per call.
 */
export function createLuteConfigLuauEditor(): ConfigLuauEditor {
	return editConfigLuauWithLuteAsync;
}

async function runLuteAsync(args: ReadonlyArray<string>): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(resolveLuteBinary(), args, (error, stdout) => {
			if (error instanceof Error) {
				reject(error);
				return;
			}

			resolve(stdout);
		});
	});
}

function readAlias(entry: object): [string, false | string] {
	const target = Reflect.get(entry, "target");
	return [String(Reflect.get(entry, "name")), typeof target === "string" ? target : false];
}

async function readPayloadAsync(
	stdout: string,
): Promise<Result<ConfigLuauInspection, ConfigLuauEditorError>> {
	const payload = Object(JSON.parse(stdout.slice(stdout.indexOf(SENTINEL) + SENTINEL.length)));
	if (Reflect.get(payload, "kind") === "unsupportedRuntime") {
		const versionOutput = await runLuteAsync(["--version"]);
		const version = versionOutput.trim();
		return {
			err: {
				kind: "uneditableConfigLuau",
				reason: `lute ${version} is too old; setup needs lute ${MINIMUM_LUTE_VERSION} or newer`,
			},
			success: false,
		};
	}

	const reason = Reflect.get(payload, "reason");
	if (typeof reason === "string") {
		return { err: { kind: "uneditableConfigLuau", reason }, success: false };
	}

	const entries = [Reflect.get(payload, "aliases")].flat();
	return {
		data: {
			aliases: Object.fromEntries(entries.map((entry) => readAlias(Object(entry)))),
			edited: String(Reflect.get(payload, "edited")),
		},
		success: true,
	};
}

async function editConfigLuauWithLuteAsync(
	source: string,
	{ alias, target }: { readonly alias: string; readonly target: string },
): Promise<Result<ConfigLuauInspection, ConfigLuauEditorError>> {
	const directory = mkdtempSync(join(tmpdir(), `bedrock-config-luau-editor-${process.pid}-`));
	const editorPath = join(directory, "editor.luau");
	const sourcePath = join(directory, "source.luau");
	writeFileSync(editorPath, editorSource);
	writeFileSync(sourcePath, source);
	try {
		const stdout = await runLuteAsync(["run", editorPath, sourcePath, alias, target]);
		return await readPayloadAsync(stdout);
	} catch (err) {
		if (isEnoentError(err)) {
			return { err: { hint: LUAU_RUNTIME_HINT, kind: "missingRuntime" }, success: false };
		}

		return {
			err: { kind: "editorFailed", message: String(Reflect.get(Object(err), "message")) },
			success: false,
		};
	} finally {
		rmSync(directory, { recursive: true });
	}
}
