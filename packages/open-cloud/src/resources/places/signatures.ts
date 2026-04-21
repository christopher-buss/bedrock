/**
 * Magic-byte prefix every Roblox binary place file (`.rbxl`) starts with.
 * The first 8 bytes spell out `<roblox!` in ASCII; the remaining 6 bytes
 * (`\x89\xff\r\n\x1a\n`) are the binary-format marker that distinguishes a
 * binary place file from the XML form (`.rbxlx`), whose ASCII-only header
 * begins with `<roblox `.
 */
export const RBXL_SIGNATURE: Readonly<Uint8Array<ArrayBuffer>> = new Uint8Array([
	0x3c, 0x72, 0x6f, 0x62, 0x6c, 0x6f, 0x78, 0x21, 0x89, 0xff, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Magic-byte prefix every Roblox XML place file (`.rbxlx`) starts with.
 * Equivalent to the ASCII string `<roblox ` (note the trailing space): a
 * well-formed rbxlx file opens with `<roblox` followed by attributes, while
 * an rbxl file uses `<roblox!` (exclamation mark) as the eighth byte. The
 * trailing space is what proves the file is the XML variant rather than
 * the binary one.
 */
export const RBXLX_SIGNATURE: Readonly<Uint8Array<ArrayBuffer>> = new Uint8Array([
	0x3c, 0x72, 0x6f, 0x62, 0x6c, 0x6f, 0x78, 0x20,
]);

/**
 * Reports whether `body` begins with `signature`. A pure byte-prefix check
 * with no allocation; used by the place builder to disambiguate `.rbxl` and
 * `.rbxlx` payloads against their declared `format`.
 *
 * @param body - The caller-supplied place file bytes.
 * @param signature - One of the frozen signature constants from this module.
 * @returns `true` if every byte of `signature` matches `body[0..signature.length]`.
 */
export function matchesSignature(
	body: Uint8Array,
	signature: Readonly<Uint8Array<ArrayBuffer>>,
): boolean {
	for (const [index, expected] of signature.entries()) {
		if (body[index] !== expected) {
			return false;
		}
	}

	return true;
}
