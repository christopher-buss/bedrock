import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import process from "node:process";

const MIN_MAJOR_VERSION = 1;

/**
 * The result of probing for a usable `lute` runtime.
 *
 * `reason` is present only when a lute binary was actually reached but is
 * unusable (it crashed, exited non-zero, or reported an unrecognized version),
 * so callers can surface why tests are skipped. A genuinely absent binary
 * leaves `reason` undefined and skips silently.
 */
export interface LuteDetection {
	/** Whether a usable lute runtime was found. */
	readonly available: boolean;
	/**
	 * Why a reached lute is unusable. Undefined when lute is absent (skipped
	 * silently) or usable.
	 */
	readonly reason?: string;
}

type LuteSpawn = (
	command: string,
	args: ReadonlyArray<string>,
	options: { readonly encoding: "utf8" },
) => SpawnSyncReturns<string>;

/**
 * Probes for a usable `lute` Luau runtime by running `<bin> --version`.
 * Distinguishes a genuinely absent binary (spawn error, e.g. ENOENT) from a
 * present-but-broken one (non-zero exit, signal kill, or an unrecognized
 * version): the former is the expected state on machines without lute and
 * skips silently, while the latter carries a `reason` so a broken runtime is
 * not mistaken for a missing one.
 *
 * @param spawn - Spawn implementation. Defaults to `node:child_process`'s
 *   `spawnSync`; tests inject a fake.
 * @param environment - Environment source read for `BEDROCK_LUTE_PATH`.
 *   Defaults to `process.env`.
 * @returns Whether a usable lute is available, plus a reason when a reached
 *   lute is unusable.
 */
export function detectLute(
	spawn: LuteSpawn = spawnSync,
	environment: NodeJS.ProcessEnv = process.env,
): LuteDetection {
	const override = environment["BEDROCK_LUTE_PATH"];
	const bin = override !== undefined && override.length > 0 ? override : "lute";

	const result = spawn(bin, ["--version"], { encoding: "utf8" });
	if (result.error !== undefined) {
		// Could not spawn the binary at all (ENOENT and friends): lute is simply
		// absent, the expected state on machines without it. Skip silently.
		return { available: false };
	}

	const spawnReason = unusableSpawnReason(bin, result);
	if (spawnReason !== undefined) {
		return { available: false, reason: spawnReason };
	}

	// Assumes `lute --version` prints a bare semver string like "1.0.0", which
	// is the v1.0.0 binary's actual format. `parseInt` reads the leading major
	// and stops at the first dot. A future build that prepends a label (e.g.
	// "lute 1.0.0") parses to NaN; rather than silently skip a perfectly good
	// runtime, that surfaces as an unrecognized-version reason.
	const versionText = result.stdout.trim();
	const major = Number.parseInt(versionText, 10);
	if (!Number.isFinite(major)) {
		return {
			available: false,
			reason: `lute reported an unrecognized version: "${versionText}"`,
		};
	}

	// A valid-but-older version is a deliberate, silent skip: older `lute`
	// builds use `@std` module shapes the bootstrap does not target and would
	// fail at runtime in confusing ways.
	return { available: major >= MIN_MAJOR_VERSION };
}

/**
 * Applies a {@link LuteDetection}: warns when a reached lute is unusable so the
 * skip is not silent, and returns whether a usable lute is available.
 *
 * @param detection - The probe result to act on.
 * @param warn - Sink for the diagnostic. Defaults to `console.warn`; tests
 *   inject a spy.
 * @returns Whether a usable lute is available.
 */
export function reportLute(
	detection: LuteDetection,
	warn: (message: string) => void = console.warn,
): boolean {
	if (detection.reason !== undefined) {
		warn(`[bedrock] ${detection.reason}`);
	}

	return detection.available;
}

function unusableSpawnReason(bin: string, result: SpawnSyncReturns<string>): string | undefined {
	if (typeof result.status !== "number") {
		return `lute "${bin} --version" was killed by signal ${result.signal ?? "unknown"}`;
	}

	if (result.status !== 0) {
		return `lute "${bin} --version" exited with status ${String(result.status)}`;
	}

	return undefined;
}

/**
 * Whether a usable `lute` Luau runtime is reachable from this process. True
 * when either `BEDROCK_LUTE_PATH` points at a binary or `lute` resolves on
 * PATH **and** the binary reports a major version >= 1.
 *
 * A present-but-broken lute (crash, non-zero exit, or unrecognized version)
 * warns once at module load rather than skipping tests silently; a genuinely
 * absent binary skips without noise.
 *
 * Computed once at module load. Tests that exercise the Luau config loader
 * gate themselves on this constant via `it.skipIf(!HAS_LUTE)`.
 */
export const HAS_LUTE: boolean = reportLute(detectLute());
