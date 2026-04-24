/**
 * Compute the SHA-256 hex digest of a byte sequence. Shared by kind modules
 * that hash file contents as part of pre-I/O normalization.
 *
 * @param bytes - Source bytes; typically the output of an injected `readFile`.
 * @returns Lowercase 64-character hex string.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	// `Uint8Array.from(bytes)` narrows `Uint8Array<ArrayBufferLike>` to
	// `Uint8Array<ArrayBuffer>` for `crypto.subtle.digest`, which rejects the
	// SharedArrayBuffer variant at the type level.
	const buffer = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}
