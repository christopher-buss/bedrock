/**
 * Gzips bytes with the web `CompressionStream`, for tests that need raw gzip
 * content.
 *
 * @param bytes - The content to compress.
 * @returns The gzip-encoded content.
 */
export async function gzipAsync(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
	const blob = new Blob([bytes]);
	const compressed = blob.stream().pipeThrough(new CompressionStream("gzip"));
	const response = new Response(compressed);
	return new Uint8Array(await response.arrayBuffer());
}
