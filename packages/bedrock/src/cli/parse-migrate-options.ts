import type { Result } from "@bedrock/ocale";

import type { ParseOptionsError } from "./parse-options.ts";

/**
 * Sources `bedrock migrate --from <source>` accepts. Today only `"mantle"`
 * is wired up; widening this tuple turns on additional sources without
 * touching the parser.
 */
export const SUPPORTED_MIGRATION_SOURCES = ["mantle"] as const;

/** One element of {@link SUPPORTED_MIGRATION_SOURCES}. */
export type MigrationSource = (typeof SUPPORTED_MIGRATION_SOURCES)[number];

/** Typed shape the migrate command consumes after `--from` has been validated. */
export interface MigrateOptions {
	/** Validated source to migrate from. */
	readonly from: MigrationSource;
}

/**
 * Failure surfaced by `parseMigrateOptions`. Reuses the three flag-shape
 * variants from `ParseOptionsError` (so the existing `renderParseError`
 * messages stay consistent) and adds `unknownSource` for `--from` values
 * outside {@link SUPPORTED_MIGRATION_SOURCES}.
 */
export type ParseMigrateError =
	| ParseOptionsError
	| {
			readonly kind: "unknownSource";
			readonly received: string;
			readonly supported: ReadonlyArray<string>;
	  };

const RECOGNIZED_FLAGS: ReadonlySet<string> = new Set(["from"]);

const SADE_RESERVED: ReadonlySet<string> = new Set(["--", "_", "h", "help", "v", "version"]);

/**
 * Translate the raw sade options POJO into a typed `MigrateOptions`. The
 * positional `<stateFilePath>` argument is not handled here: sade hands
 * positional values to the action callback ahead of the options object,
 * and the migrate command falls back to an interactive prompt when it
 * is absent. This parser only covers the `--from` flag.
 *
 * @param rawOptions - The options object sade hands the action callback.
 * @returns `Ok(MigrateOptions)` on success, or `Err(ParseMigrateError)`
 *   describing the offending flag or value.
 */
export function parseMigrateOptions(
	rawOptions: Readonly<Record<string, unknown>>,
): Result<MigrateOptions, ParseMigrateError> {
	for (const key of Object.keys(rawOptions)) {
		if (!RECOGNIZED_FLAGS.has(key) && !SADE_RESERVED.has(key)) {
			return { err: { flag: key, kind: "unknownFlag" }, success: false };
		}
	}

	const fromRaw = rawOptions["from"];
	if (fromRaw === undefined) {
		return { err: { flag: "from", kind: "missingRequired" }, success: false };
	}

	if (typeof fromRaw !== "string") {
		return { err: { flag: "from", kind: "invalidValue" }, success: false };
	}

	if (!isMigrationSource(fromRaw)) {
		return {
			err: {
				kind: "unknownSource",
				received: fromRaw,
				supported: SUPPORTED_MIGRATION_SOURCES,
			},
			success: false,
		};
	}

	return { data: { from: fromRaw }, success: true };
}

function isMigrationSource(value: string): value is MigrationSource {
	return (SUPPORTED_MIGRATION_SOURCES as ReadonlyArray<string>).includes(value);
}
