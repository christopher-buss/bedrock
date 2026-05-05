import { join } from "node:path";

import { sha256Hex } from "../core/kinds/hash.ts";
import type { EnvironmentFoldResult } from "../core/migrate/fold-environment.ts";
import type { PassFoldEntry } from "../core/migrate/fold-passes.ts";
import type { ProductFoldEntry } from "../core/migrate/fold-products.ts";
import type { MigrationWarning } from "../core/migrate/migration-report.ts";
import { asSha256Hex, type ResourceKey, type Sha256Hex } from "../types/ids.ts";

/**
 * Result of walking each environment's pass, product, and universe entries
 * and recomputing the SHA-256 digest of every locale-keyed icon path from
 * disk. `passHashesByEnvironment` and `productHashesByEnvironment` carry the
 * recomputed digests keyed by environment then by resource key; the inner
 * record mirrors `GamePassDesiredState.iconFileHashes` /
 * `DeveloperProductDesiredState.iconFileHashes`.
 * `universeHashByEnvironment` carries the per-environment digest of the
 * experience-icon singleton; environments without an experience icon, and
 * environments whose icon file could not be read, are absent from the map.
 * `warnings` carries one `kind: "ambiguous"` warning per resource whose icon
 * could not be read so the caller can fall back to the Mantle-recorded
 * hashes (passes / products) or omit the icon (universe) without losing the
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
	/**
	 * Recomputed experience-icon digest keyed by environment. Absent when
	 * the environment has no experience-icon resource or when the icon file
	 * could not be read.
	 */
	readonly universeHashByEnvironment: ReadonlyMap<string, Record<"en-us", Sha256Hex>>;
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
	readonly universeHash: Record<"en-us", Sha256Hex> | undefined;
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

interface UniverseIconWalkResult {
	readonly hash: Record<"en-us", Sha256Hex> | undefined;
	readonly warnings: ReadonlyArray<MigrationWarning>;
}

/**
 * Walk each environment's folded pass, product, and universe entries,
 * resolve the locale-keyed icon paths against `stateFileDirectory`, read
 * the bytes via the injected `readFile`, and compute the SHA-256 hex
 * digest. Files that cannot be read surface as `ambiguous`
 * `MigrationWarning`s with the environment-prefixed `mantlePath` and a
 * hint pointing at the resolved path; the caller carries the
 * Mantle-recorded hashes forward as a fallback for passes and products,
 * and omits the icon entirely on the universe resource. Products without
 * an icon partner and environments without an experience icon are
 * silently skipped.
 *
 * @param inputs - Per-environment fold results plus I/O dependencies.
 * @returns Per-environment recomputed pass, product, and universe hashes
 *   plus accumulated ambiguous warnings.
 */
export async function recomputeIconHashes(
	inputs: RecomputeIconHashesInputs,
): Promise<IconHashRecomputation> {
	const walked = await Promise.all(
		[...inputs.folds.entries()].map(async ([environment, folded]) => {
			const result = await walkEnvironment({
				environmentName: environment,
				folded,
				readFile: inputs.readFile,
				stateFileDirectory: inputs.stateFileDirectory,
			});
			return [environment, result] as const;
		}),
	);

	return collectRecomputation(walked);
}

function collectRecomputation(
	walked: ReadonlyArray<readonly [string, WalkEnvironmentResult]>,
): IconHashRecomputation {
	return {
		passHashesByEnvironment: new Map(
			walked.map(([environment, walk]) => [environment, walk.passHashes]),
		),
		productHashesByEnvironment: new Map(
			walked.map(([environment, walk]) => [environment, walk.productHashes]),
		),
		universeHashByEnvironment: new Map(
			walked.flatMap(([environment, walk]) => {
				return walk.universeHash === undefined
					? []
					: [[environment, walk.universeHash] as const];
			}),
		),
		warnings: walked.flatMap(([, walk]) => walk.warnings),
	};
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

async function walkUniverseIcon(inputs: WalkEnvironmentInputs): Promise<UniverseIconWalkResult> {
	const iconPath = inputs.folded.universe?.entry.icon?.["en-us"];
	if (iconPath === undefined) {
		return { hash: undefined, warnings: [] };
	}

	const resolved = join(inputs.stateFileDirectory, iconPath);
	const recomputed = await tryRecomputeHash(inputs.readFile, resolved);
	if (recomputed === undefined) {
		return {
			hash: undefined,
			warnings: [
				buildAmbiguousIconWarning({
					environmentName: inputs.environmentName,
					mantlePath: "experienceIcon_singleton",
					resolvedPath: resolved,
				}),
			],
		};
	}

	return { hash: { "en-us": recomputed }, warnings: [] };
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
	const universeWalk = await walkUniverseIcon({
		environmentName: inputs.environmentName,
		folded: inputs.folded,
		readFile: inputs.readFile,
		stateFileDirectory: inputs.stateFileDirectory,
	});
	return {
		passHashes: passWalk.perKey,
		productHashes: productWalk.perKey,
		universeHash: universeWalk.hash,
		warnings: [...passWalk.warnings, ...productWalk.warnings, ...universeWalk.warnings],
	};
}
