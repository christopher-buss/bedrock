import type { Result } from "@bedrock/ocale";

import { parseYAML } from "confbox";

import type { MigrateError } from "./migration-report.ts";
import type { MantleResource, MantleStateV6 } from "./types.ts";

const SUPPORTED_VERSIONS = ["6"] as const;

/**
 * Parse the contents of a `.mantle-state.yml` file into a typed
 * `MantleStateV6` envelope. Pure: takes a string, returns a `Result`.
 *
 * The parser also normalizes JSON `null` values to `undefined` recursively
 * across each resource's `inputs` and `outputs` payloads (per the project
 * type convention) and splits each resource's `id` field into the
 * `(kind, key)` pair carried on `MantleResource`.
 *
 * Surfaces three discriminated `MigrateError` kinds:
 * - `stateParseFailed` when the YAML parser refuses the file or its
 *   structural shape (missing `environments`, malformed resource entry,
 *   non-string `id`, etc.) does not match the v6 envelope.
 * - `unsupportedMantleStateVersion` when the `version` field decodes but
 *   is not one of the values in `SUPPORTED_VERSIONS`.
 *
 * @param raw - Raw YAML text decoded from the state file.
 * @param sourceFile - Path or identifier of the source file, threaded into
 *   any returned `MigrateError` for diagnostics.
 * @returns `Ok` with the parsed envelope, or `Err` with a discriminated
 *   `MigrateError` describing why the file was rejected.
 */
export function parseState(raw: string, sourceFile: string): Result<MantleStateV6, MigrateError> {
	let envelope: Record<string, unknown>;
	try {
		const parsed = parseYAML(raw);
		envelope = expectObject(parsed);
	} catch (err) {
		return parseFailedFrom(err, sourceFile);
	}

	const versionResult = parseVersion(envelope["version"]);
	if (!versionResult.success) {
		return versionResult;
	}

	let environments: Readonly<Record<string, ReadonlyArray<MantleResource>>>;
	try {
		environments = parseEnvironments(envelope["environments"]);
	} catch (err) {
		return parseFailedFrom(err, sourceFile);
	}

	return {
		data: { environments, version: versionResult.data },
		success: true,
	};
}

function parseVersion(raw: unknown): Result<"6", MigrateError> {
	const found = typeof raw === "string" ? raw : String(raw);
	if (found !== "6") {
		return {
			err: {
				found,
				kind: "unsupportedMantleStateVersion",
				supported: SUPPORTED_VERSIONS,
			},
			success: false,
		};
	}

	return { data: "6", success: true };
}

function isObjectPayload(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
	if (value === null) {
		return "null";
	}

	if (Array.isArray(value)) {
		return "array";
	}

	return typeof value;
}

function expectObject(value: unknown): Record<string, unknown> {
	if (!isObjectPayload(value)) {
		throw new TypeError(`expected object, got ${describe(value)}`);
	}

	return value;
}

function expectArray(value: unknown): ReadonlyArray<unknown> {
	if (!Array.isArray(value)) {
		throw new TypeError(`expected array, got ${describe(value)}`);
	}

	return value;
}

function expectString(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new TypeError(`expected ${label} to be a string, got ${describe(value)}`);
	}

	return value;
}

function stripNulls(value: unknown): unknown {
	if (value === null) {
		return undefined;
	}

	if (Array.isArray(value)) {
		return value.map(stripNulls);
	}

	if (isObjectPayload(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [key, stripNulls(child)]),
		);
	}

	return value;
}

function parseResource(value: unknown): MantleResource {
	const resource = expectObject(value);
	const id = expectString(resource["id"], "id");
	const underscoreIndex = id.indexOf("_");
	if (underscoreIndex <= 0 || underscoreIndex === id.length - 1) {
		throw new Error(`expected id of form <kind>_<key>, got "${id}"`);
	}

	const kind = id.slice(0, underscoreIndex);
	const key = id.slice(underscoreIndex + 1);

	const inputsObject = expectObject(resource["inputs"]);
	const inputs = stripNulls(inputsObject[kind]);

	const outputsRaw = resource["outputs"];
	const outputs = isObjectPayload(outputsRaw) ? stripNulls(outputsRaw[kind]) : undefined;

	const dependencies = expectArray(resource["dependencies"]).map((dep) => {
		return expectString(dep, "dependency");
	});

	return { key, dependencies, inputs, kind, outputs };
}

function parseEnvironments(raw: unknown): Readonly<Record<string, ReadonlyArray<MantleResource>>> {
	const environmentsObject = expectObject(raw);
	return Object.fromEntries(
		Object.entries(environmentsObject).map(([name, value]) => [
			name,
			expectArray(value).map(parseResource),
		]),
	);
}

function parseFailedFrom(err: unknown, sourceFile: string): Result<MantleStateV6, MigrateError> {
	const reason = err instanceof Error ? err.message : String(err);
	return {
		err: { kind: "stateParseFailed", path: sourceFile, reason },
		success: false,
	};
}
