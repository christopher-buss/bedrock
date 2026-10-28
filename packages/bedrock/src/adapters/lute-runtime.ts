import process from "node:process";

/** How to make the `lute` runtime reachable. */
export const LUAU_RUNTIME_HINT =
	"install lute (e.g. `mise install` with `github:luau-lang/lute`) or set BEDROCK_LUTE_PATH to the binary.";

/**
 * The `lute` binary to run: `BEDROCK_LUTE_PATH` when set and non-empty,
 * else `lute` from `PATH`.
 *
 * @returns The binary path or name.
 */
export function resolveLuteBinary(): string {
	const overridePath = process.env["BEDROCK_LUTE_PATH"];
	return overridePath !== undefined && overridePath.length > 0 ? overridePath : "lute";
}

/**
 * Whether a spawn failed because the binary does not exist.
 *
 * @param error - The value the spawn rejected with.
 * @returns `true` for an `ENOENT` error.
 */
export function isEnoentError(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
