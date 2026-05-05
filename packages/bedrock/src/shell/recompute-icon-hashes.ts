import { join } from "node:path";

import { sha256Hex } from "../core/kinds/hash.ts";
import type { EnvironmentFoldResult } from "../core/migrate/fold-environment.ts";
import type { PassFoldEntry } from "../core/migrate/fold-passes.ts";
import type { ProductFoldEntry } from "../core/migrate/fold-products.ts";
import type { MigrationWarning } from "../core/migrate/migration-report.ts";
import { asSha256Hex, type ResourceKey, type Sha256Hex } from "../types/ids.ts";

/**
 * Result of walking each environment's pass and product entries and
 * recomputing the SHA-256 digest of every locale-keyed icon path from disk.
 * `passHashesByEnvironment` and `productHashesByEnvironment` carry the
 * recomputed digests keyed by environment then by resource key; the inner
 * record mirrors `GamePassDesiredState.iconFileHashes` /
 * `DeveloperProductDesiredState.iconFileHashes`. `warnings` carries one
 * `kind: "ambiguous"` warning per resource whose icon could not be read so
 * the caller can fall back to the Mantle-recorded hashes without losing the
 * diagnostic.
 */
export interface IconHashRecomputation {
	/** Recomputed pass-icon digests keyed by environment then by pass key. */
	readonly passHashesByEnvironment: ReadonlyMap<
		string,
		ReadonlyMap<ResourceKey, Record<"en-us", Sha256Hex>>
	>;
	/** Recomputed product-icon digests keyed by environment then by product key. */
	readonly productHashesByEnvironment: ReadonlyMap<
		string,
		ReadonlyMap<ResourceKey, Record<"en-us", Sha256Hex>>
	>;
	/** One ambiguous warning per resource whose icon could not be read. */
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

/** Inputs for {@link recomputeIconHashes}. */
interface RecomputeIconHashesInputs {
	/** Per-environment fold results carrying pass and product entries to walk. */
	readonly folds: ReadonlyMap<string, EnvironmentFoldResult>;
	/** Reads file bytes; same shape as `MigrateMantleStateDeps.readFile`. */
	readonly readFile: (path: string) => Promise<Uint8Array>;
	/** Directory the state file lives in; relative icon paths resolve against it. */
	readonly stateFileDirectory: string;
}

interface IconWalkEntry {
	readonly key: ResourceKey;
	readonly iconPath: string;
	readonly mantlePath: string;
}

interface IconWalkInputs {
	readonly entries: ReadonlyArray<IconWalkEntry>;
	readonly environmentName: string;
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly stateFileDirectory: string;
}

interface IconWalkResult {
	readonly perKey: ReadonlyMap<ResourceKey, Record<"en-us", Sha256Hex>>;
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

interface AmbiguousIconWarningInputs {
	readonly environmentName: string;
	readonly mantlePath: string;
	readonly resolvedPath: string;
}

interface WalkEnvironmentInputs {
	readonly environmentName: string;
	readonly folded: EnvironmentFoldResult;
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly stateFileDirectory: string;
}

interface WalkEnvironmentResult {
	readonly passHashes: ReadonlyMap<ResourceKey, Record<"en-us", Sha256Hex>>;
	readonly productHashes: ReadonlyMap<ResourceKey, Record<"en-us", Sha256Hex>>;
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

/**
 * Walk each environment's folded pass and product entries, resolve the
 * locale-keyed icon paths against `stateFileDirectory`, read the bytes via
 * the injected `readFile`, and compute the SHA-256 hex digest. Files that
 * cannot be read surface as `ambiguous` `MigrationWarning`s with the
 * environment-prefixed `mantlePath` and a hint pointing at the resolved
 * path; the caller carries the Mantle-recorded hashes forward as a
 * fallback. Products without an icon partner are silently skipped.
 *
 * @param inputs - Per-environment fold results plus I/O dependencies.
 * @returns Per-environment recomputed pass and product hashes plus
 *   accumulated ambiguous warnings.
 */
export async function recomputeIconHashes(
	inputs: RecomputeIconHashesInputs,
): Promise<IconHashRecomputation> {
	const passHashesByEnvironment = new Map<
		string,
		ReadonlyMap<ResourceKey, Record<"en-us", Sha256Hex>>
	>();
	const productHashesByEnvironment = new Map<
		string,
		ReadonlyMap<ResourceKey, Record<"en-us", Sha256Hex>>
	>();
	const warnings: Array<MigrationWarning> = [];

	for (const [environment, folded] of inputs.folds) {
		const walked = await walkEnvironment({
			environmentName: environment,
			folded,
			readFile: inputs.readFile,
			stateFileDirectory: inputs.stateFileDirectory,
		});
		passHashesByEnvironment.set(environment, walked.passHashes);
		productHashesByEnvironment.set(environment, walked.productHashes);
		warnings.push(...walked.warnings);
	}

	return { passHashesByEnvironment, productHashesByEnvironment, warnings };
}

function passWalkEntry(entry: PassFoldEntry): IconWalkEntry {
	return {
		key: entry.key,
		iconPath: entry.entry.icon["en-us"],
		mantlePath: entry.mantlePath,
	};
}

function productWalkEntries(entry: ProductFoldEntry): ReadonlyArray<IconWalkEntry> {
	if (entry.entry.icon === undefined) {
		return [];
	}

	return [
		{
			key: entry.key,
			iconPath: entry.entry.icon["en-us"],
			mantlePath: entry.mantlePath,
		},
	];
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
		hint: `Could not read icon file at ${inputs.resolvedPath}; verify the file's location relative to the state file or correct the icon entry before re-running.`,
		kind: "ambiguous",
		mantlePath: `${inputs.environmentName}.${inputs.mantlePath}`,
	};
}

async function walkIconEntries(inputs: IconWalkInputs): Promise<IconWalkResult> {
	const perKey = new Map<ResourceKey, Record<"en-us", Sha256Hex>>();
	const warnings: Array<MigrationWarning> = [];
	for (const entry of inputs.entries) {
		const resolved = join(inputs.stateFileDirectory, entry.iconPath);
		const recomputed = await tryRecomputeHash(inputs.readFile, resolved);
		if (recomputed === undefined) {
			warnings.push(
				buildAmbiguousIconWarning({
					environmentName: inputs.environmentName,
					mantlePath: entry.mantlePath,
					resolvedPath: resolved,
				}),
			);
		} else {
			perKey.set(entry.key, { "en-us": recomputed });
		}
	}

	return { perKey, warnings };
}

async function walkEnvironment(inputs: WalkEnvironmentInputs): Promise<WalkEnvironmentResult> {
	const passWalk = await walkIconEntries({
		entries: inputs.folded.passes.map(passWalkEntry),
		environmentName: inputs.environmentName,
		readFile: inputs.readFile,
		stateFileDirectory: inputs.stateFileDirectory,
	});
	const productWalk = await walkIconEntries({
		entries: inputs.folded.products.flatMap(productWalkEntries),
		environmentName: inputs.environmentName,
		readFile: inputs.readFile,
		stateFileDirectory: inputs.stateFileDirectory,
	});
	return {
		passHashes: passWalk.perKey,
		productHashes: productWalk.perKey,
		warnings: [...passWalk.warnings, ...productWalk.warnings],
	};
}
