import type { Result } from "@bedrock-rbx/ocale";

import type { ResourceKey } from "../../types/ids.ts";
import { isRedactedIconPath, REDACTED_ICON_BYTES } from "../redacted-icon.ts";
import type { BuildDesiredError, KindIo } from "./module.ts";

/**
 * Read file bytes via the injected reader, translating rejections into a
 * `fileReadFailed` `BuildDesiredError`. Shared by kind modules whose
 * pre-I/O normalization hashes a file the user declared by path. The
 * redacted-icon sentinel short-circuits to the embedded placeholder
 * bytes without invoking the injected reader, so a redaction-substituted
 * icon path produces a deterministic hash on every deploy.
 *
 * @param target - Path to read plus the resource key blamed on failure.
 * @param io - I/O surface carrying the injected `readFile` function.
 * @returns `Ok` with the bytes, or `Err` with a `fileReadFailed` error.
 */
export async function readBytes(
	target: { readonly filePath: string; readonly key: ResourceKey },
	io: KindIo,
): Promise<Result<Uint8Array, BuildDesiredError>> {
	if (isRedactedIconPath(target.filePath)) {
		return { data: REDACTED_ICON_BYTES, success: true };
	}

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
