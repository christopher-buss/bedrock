import { spawnSync } from "node:child_process";
import process from "node:process";

/**
 * Whether the `lute` Luau runtime is reachable from this process. True when
 * either `BEDROCK_LUTE_PATH` points at a binary or `lute` resolves on PATH.
 *
 * Computed once at module load. Tests that exercise the Luau config loader
 * gate themselves on this constant via `it.skipIf(!HAS_LUTE)` so the suite
 * stays runnable on machines without lute installed (CI installs it through
 * mise; local contributors may not).
 */
export const HAS_LUTE: boolean = (() => {
	if ((process.env["BEDROCK_LUTE_PATH"] ?? "").length > 0) {
		return true;
	}

	const lookup = process.platform === "win32" ? "where" : "which";
	return spawnSync(lookup, ["lute"]).status === 0;
})();
