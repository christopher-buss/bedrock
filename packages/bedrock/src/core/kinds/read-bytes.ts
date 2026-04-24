import type { Result } from "@bedrock/ocale";

import type { ResourceKey } from "../../types/ids.ts";
import type { BuildDesiredError, KindIo } from "./module.ts";

/**
 * Read file bytes via the injected reader, translating rejections into a
 * `fileReadFailed` `BuildDesiredError`. Shared by kind modules whose
 * pre-I/O normalization hashes a file the user declared by path.
 *
 * @param target - Path to read plus the resource key blamed on failure.
 * @param io - I/O surface carrying the injected `readFile` function.
 * @returns `Ok` with the bytes, or `Err` with a `fileReadFailed` error.
 */
export async function readBytes(
	target: { readonly filePath: string; readonly key: ResourceKey },
	io: KindIo,
): Promise<Result<Uint8Array, BuildDesiredError>> {
	try {
		return { data: await io.readFile(target.filePath), success: true };
	} catch (err) {
		return {
			err: {
				key: target.key,
				filePath: target.filePath,
				kind: "fileReadFailed",
				reason: err instanceof Error ? err.message : String(err),
			},
			success: false,
		};
	}
}
