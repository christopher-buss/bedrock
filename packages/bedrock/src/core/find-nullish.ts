import { isAbsolute, normalize } from "node:path";

import type { ConfigValidationIssue } from "./config-error.ts";
import { isRecord } from "./is-record.ts";

/** One raw config layer as c12 read it, before any merge. */
export interface RawConfigLayer {
	/** The layer's own config, as written. */
	readonly config?: unknown;
	/**
	 * The file the layer was read from. C12 records the main file under its
	 * bare name and each `extends` layer under an absolute path.
	 */
	readonly configFile?: string | undefined;
}

/** One resource field a raw config layer sets to `null` or `undefined`. */
export interface NullishField {
	/** Keys from the layer root to the field. */
	readonly path: ReadonlyArray<string>;
	/** The value the layer wrote. */
	readonly value: null | undefined;
}

/** Config sections that hold resources, at the root and in each environment. */
const RESOURCE_SECTIONS = ["passes", "products", "places", "universe"] as const;

/**
 * Find every key inside the resource sections of one raw config layer that
 * is present with a `null` or `undefined` value.
 *
 * Runs on each layer as written, before c12 merges `extends` layers: that
 * merge drops nullish keys, so a `null` over an extended value would
 * otherwise reach validation as the extended value. Only `passes`,
 * `products`, `places`, and `universe` are scanned, at the root and under
 * each `environments.<name>`, so a plugin's `state` block may still use
 * `null`.
 *
 * Internal seam: not re-exported from `src/index.ts`.
 *
 * @param config - One raw config layer.
 * @returns Each nullish key, in the order the scan meets them.
 */
export function findNullishResourcePaths(config: unknown): ReadonlyArray<NullishField> {
	if (!isRecord(config)) {
		return [];
	}

	const environments = isRecord(config["environments"]) ? config["environments"] : {};
	return [
		...findInSections(config, []),
		...Object.entries(environments).flatMap(([name, entry]) => {
			return isRecord(entry) ? findInSections(entry, ["environments", name]) : [];
		}),
	];
}

/**
 * Report every resource field a raw config layer sets to `null` or
 * `undefined`, with a hint naming the layer's file.
 *
 * Internal seam: not re-exported from `src/index.ts`.
 *
 * @param layers - The main config file and every `extends` layer.
 * @param mainFile - The main config file, named for a layer whose own file
 * is not an absolute path.
 * @returns One issue per nullish field.
 */
export function collectNullishIssues(
	layers: ReadonlyArray<RawConfigLayer>,
	mainFile: string,
): ReadonlyArray<ConfigValidationIssue> {
	return layers.flatMap(({ config, configFile }) => {
		const file = normalize(
			configFile !== undefined && isAbsolute(configFile) ? configFile : mainFile,
		);
		return findNullishResourcePaths(config).map(({ path, value }) => {
			return {
				message: `is ${String(value)} in ${file}: write \`$none\` to turn the field off, or remove the key to inherit it`,
				path,
			};
		});
	});
}

function findNullish(value: unknown, path: ReadonlyArray<string>): ReadonlyArray<NullishField> {
	if (value === null || value === undefined) {
		return [{ path, value }];
	}

	if (!isRecord(value)) {
		return [];
	}

	return Object.entries(value).flatMap(([key, item]) => findNullish(item, [...path, key]));
}

function findInSections(
	scope: Readonly<Record<string, unknown>>,
	path: ReadonlyArray<string>,
): ReadonlyArray<NullishField> {
	return RESOURCE_SECTIONS.flatMap((section) => {
		return section in scope ? findNullish(scope[section], [...path, section]) : [];
	});
}
