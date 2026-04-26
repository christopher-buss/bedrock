import { spawnSync } from "node:child_process";
import process from "node:process";

const MIN_MAJOR_VERSION = 1;

/**
 * Whether a usable `lute` Luau runtime is reachable from this process. True
 * when either `BEDROCK_LUTE_PATH` points at a binary or `lute` resolves on
 * PATH **and** the binary reports a major version >= 1.
 *
 * Older `lute` builds (notably the v0.1.x nightly series) use different
 * `@std` module shapes that the bootstrap does not target;
 * they would fail at runtime in confusing ways. Gating on the version means
 * tests skip cleanly on machines that happen to have an older binary first
 * on PATH.
 *
 * Computed once at module load. Tests that exercise the Luau config loader
 * gate themselves on this constant via `it.skipIf(!HAS_LUTE)`.
 */
export const HAS_LUTE: boolean = (() => {
	const override = process.env["BEDROCK_LUTE_PATH"];
	const bin = override !== undefined && override.length > 0 ? override : "lute";

	const result = spawnSync(bin, ["--version"], { encoding: "utf8" });
	if (result.status !== 0) {
		return false;
	}

	const major = Number.parseInt(result.stdout.trim().split(".")[0] ?? "", 10);
	return Number.isFinite(major) && major >= MIN_MAJOR_VERSION;
})();
