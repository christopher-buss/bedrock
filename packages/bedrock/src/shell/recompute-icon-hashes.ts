import { join } from "node:path";

import { sha256Hex } from "../core/kinds/hash.ts";
import type { EnvironmentFoldResult } from "../core/migrate/fold-environment.ts";
import type { PassFoldEntry } from "../core/migrate/fold-passes.ts";
import type { MigrationWarning } from "../core/migrate/migration-report.ts";
import { asSha256Hex, type ResourceKey, type Sha256Hex } from "../types/ids.ts";

/**
 * Result of walking each environment's pass entries and recomputing the
 * SHA-256 digest of every `iconFilePath` from disk. `hashesByEnvironment`
 * carries the recomputed digests keyed by environment then by pass key;
 * `warnings` carries one `kind: "ambiguous"` warning per pass whose icon
 * could not be read so the caller can fall back to the Mantle-recorded
 * hash without losing the diagnostic.
 */
export interface IconHashRecomputation {
	/** Recomputed digests keyed by environment then by pass key. */
	readonly hashesByEnvironment: ReadonlyMap<string, ReadonlyMap<ResourceKey, Sha256Hex>>;
	/** One ambiguous warning per pass whose icon could not be read. */
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

/** Inputs for {@link recomputeIconHashes}. */
export interface RecomputeIconHashesInputs {
	/** Per-environment fold results carrying pass entries to walk. */
	readonly folds: ReadonlyMap<string, EnvironmentFoldResult>;
	/** Reads file bytes; same shape as `MigrateMantleStateDeps.readFile`. */
	readonly readFile: (path: string) => Promise<Uint8Array>;
	/** Directory the state file lives in; relative `iconFilePath`s resolve against it. */
	readonly stateFileDirectory: string;
}

interface AmbiguousIconWarningInputs {
	readonly entry: PassFoldEntry;
	readonly environmentName: string;
	readonly resolvedPath: string;
}

/**
 * Walk each environment's folded pass entries, resolve the
 * `iconFilePath` against `stateFileDirectory`, read the bytes via the
 * injected `readFile`, and compute the SHA-256 hex digest. Files that
 * cannot be read surface as `ambiguous` `MigrationWarning`s with the
 * environment-prefixed `mantlePath` and a hint pointing at the resolved
 * path; the caller carries the Mantle-recorded hash forward as a
 * fallback.
 *
 * @param inputs - Per-environment fold results plus I/O dependencies.
 * @returns Per-environment recomputed hashes plus accumulated ambiguous
 *   warnings.
 */
export async function recomputeIconHashes(
	inputs: RecomputeIconHashesInputs,
): Promise<IconHashRecomputation> {
	const warnings: Array<MigrationWarning> = [];
	const hashesByEnvironment = new Map<string, ReadonlyMap<ResourceKey, Sha256Hex>>();

	for (const [environment, folded] of inputs.folds) {
		const perKey = new Map<ResourceKey, Sha256Hex>();
		for (const passEntry of folded.passes) {
			const resolved = join(inputs.stateFileDirectory, passEntry.entry.iconFilePath);
			const recomputed = await tryRecomputeHash(inputs.readFile, resolved);
			if (recomputed === undefined) {
				warnings.push(
					buildAmbiguousIconWarning({
						entry: passEntry,
						environmentName: environment,
						resolvedPath: resolved,
					}),
				);
			} else {
				perKey.set(passEntry.key, recomputed);
			}
		}

		hashesByEnvironment.set(environment, perKey);
	}

	return { hashesByEnvironment, warnings };
}

async function tryRecomputeHash(
	readFile: (path: string) => Promise<Uint8Array>,
	path: string,
): Promise<Sha256Hex | undefined> {
	try {
		const bytes = await readFile(path);
		return asSha256Hex(await sha256Hex(bytes));
	} catch {
		return undefined;
	}
}

function buildAmbiguousIconWarning(inputs: AmbiguousIconWarningInputs): MigrationWarning {
	return {
		hint: `Could not read icon file at ${inputs.resolvedPath}; verify the file's location relative to the state file or correct the iconFilePath before re-running.`,
		kind: "ambiguous",
		mantlePath: `${inputs.environmentName}.${inputs.entry.mantlePath}`,
	};
}
