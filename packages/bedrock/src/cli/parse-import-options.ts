import type { Result } from "@bedrock-rbx/ocale";

import process from "node:process";

import type { ImportKind } from "../core/import-current.ts";
import type { ImportSelection } from "../core/import-plan-types.ts";
import { isRobloxAssetId } from "../types/ids.ts";
import {
	type CommonOptions,
	credentialOptions,
	type ParseOptionsError,
	resolveVerbose,
} from "./parse-options.ts";

/** Typed shape the import command consumes. */
export interface ImportOptions extends Pick<
	CommonOptions,
	"apiKey" | "configFile" | "githubToken"
> {
	/** The Environment whose live items are imported. */
	readonly environment: string;
	/**
	 * How `--select` items link in the other Environments: `auto` by name,
	 * `none` not at all; `undefined` when `--link` is not given.
	 */
	readonly link: "auto" | "none" | undefined;
	/** The items named by `--select`, in flag order. */
	readonly selections: ReadonlyArray<ImportSelection>;
	/** Whether failures print their verbose diagnostics. */
	readonly verbose: boolean;
	/** Whether `--yes` was given, which imports without prompts. */
	readonly yes: boolean;
}

/** Why the import flags were refused. */
export type ParseImportError =
	| ParseOptionsError
	| { readonly kind: "invalidSelection"; readonly received: string };

const RECOGNIZED_FLAGS: ReadonlySet<string> = new Set([
	"--",
	"_",
	"api-key",
	"apiKey",
	"config",
	"environment",
	"github-token",
	"githubToken",
	"h",
	"help",
	"link",
	"select",
	"v",
	"verbose",
	"version",
	"yes",
]);

const KINDS: ReadonlyMap<string, ImportKind> = new Map([
	["badge", "badge"],
	["developer-product", "developerProduct"],
	["developerProduct", "developerProduct"],
	["game-pass", "gamePass"],
	["gamePass", "gamePass"],
]);

const SELECTION = /^([A-Za-z-]+):([^:]+)$/;

/**
 * Translate the raw sade options of `bedrock import` into typed options.
 * `--environment` falls back to `BEDROCK_ENVIRONMENT`, and `--verbose` to
 * `BEDROCK_VERBOSE`.
 *
 * @param rawOptions - The options object sade hands the action callback.
 * @param getEnvironment - Reads an environment variable.
 * @returns The typed options, or the offending flag or selection.
 */
export function parseImportOptions(
	rawOptions: Readonly<Record<string, unknown>>,
	getEnvironment: (name: string) => string | undefined = (name) => process.env[name],
): Result<ImportOptions, ParseImportError> {
	const unknown = Object.keys(rawOptions).find((key) => !RECOGNIZED_FLAGS.has(key));
	if (unknown !== undefined) {
		return { err: { flag: unknown, kind: "unknownFlag" }, success: false };
	}

	const environment = resolveEnvironment(rawOptions["environment"], getEnvironment);
	if (!environment.success) {
		return environment;
	}

	const selections = parseSelections(rawOptions["select"]);
	if (!selections.success) {
		return selections;
	}

	const switches = resolveSwitches(rawOptions, getEnvironment);
	if (!switches.success) {
		return switches;
	}

	return {
		data: {
			...credentialOptions(rawOptions),
			environment: environment.data,
			selections: selections.data,
			...switches.data,
		},
		success: true,
	};
}

function resolveEnvironment(
	raw: unknown,
	getEnvironment: (name: string) => string | undefined,
): Result<string, ParseOptionsError> {
	const value = raw ?? getEnvironment("BEDROCK_ENVIRONMENT");
	if (value === undefined) {
		return { err: { flag: "environment", kind: "missingRequired" }, success: false };
	}

	if (typeof value !== "string" || value === "") {
		return { err: { flag: "environment", kind: "invalidValue" }, success: false };
	}

	return { data: value, success: true };
}

function parseLink(raw: unknown): Result<ImportOptions["link"], ParseOptionsError> {
	return raw === undefined || raw === "auto" || raw === "none"
		? { data: raw, success: true }
		: { err: { flag: "link", kind: "invalidValue" }, success: false };
}

function resolveSwitches(
	rawOptions: Readonly<Record<string, unknown>>,
	getEnvironment: (name: string) => string | undefined,
): Result<Pick<ImportOptions, "link" | "verbose" | "yes">, ParseOptionsError> {
	const verbose = resolveVerbose(rawOptions["verbose"], getEnvironment);
	if (!verbose.success) {
		return verbose;
	}

	const { yes } = rawOptions;
	if (yes !== undefined && typeof yes !== "boolean") {
		return { err: { flag: "yes", kind: "switchGivenValue" }, success: false };
	}

	const link = parseLink(rawOptions["link"]);
	return link.success
		? { data: { link: link.data, verbose: verbose.data, yes: yes === true }, success: true }
		: link;
}

function parseSelection(raw: string): ImportSelection | undefined {
	const match = SELECTION.exec(raw);
	if (match === null) {
		return undefined;
	}

	const kind = KINDS.get(String(match[1]));
	const robloxId = String(match[2]);
	return kind !== undefined && isRobloxAssetId(robloxId) ? { kind, robloxId } : undefined;
}

function parseSelections(raw: unknown): Result<ReadonlyArray<ImportSelection>, ParseImportError> {
	const values: ReadonlyArray<unknown> = raw === undefined ? [] : [raw].flat();
	const selections: Array<ImportSelection> = [];
	for (const value of values) {
		if (typeof value !== "string") {
			return { err: { flag: "select", kind: "invalidValue" }, success: false };
		}

		const selection = parseSelection(value);
		if (selection === undefined) {
			return { err: { kind: "invalidSelection", received: value }, success: false };
		}

		selections.push(selection);
	}

	return { data: selections, success: true };
}
