import { tryCatchAsync } from "../../../internal/utils/try-catch.ts";
import type { Result } from "../../../types.ts";

const GZIP_MAGIC_FIRST = 0x1f;
const GZIP_MAGIC_SECOND = 0x8b;

/**
 * Gunzips asset content that still starts with the gzip magic bytes. `fetch`
 * decodes a `Content-Encoding: gzip` body itself, but the CDN may also serve
 * raw gzip bytes without that header. Other content is returned unchanged.
 *
 * @param bytes - The downloaded content.
 * @returns The decoded content, or the decompression error.
 */
export async function decodeAssetContentAsync(bytes: Uint8Array): Promise<Result<Uint8Array>> {
	if (bytes[0] !== GZIP_MAGIC_FIRST || bytes[1] !== GZIP_MAGIC_SECOND) {
		return { data: bytes, success: true };
	}

	const blob = new Blob([new Uint8Array(bytes)]);
	const response = new Response(blob.stream().pipeThrough(new DecompressionStream("gzip")));
	const decoded = await tryCatchAsync(response.arrayBuffer());
	return decoded.success
		? { data: new Uint8Array(decoded.data), success: true }
		: { err: decoded.err, success: false };
}
