/**
 * Caller-supplied input for the `publish` and `save` methods on
 * `PlacesClient`. Both methods take the same parameter shape; which
 * version-type query string is used is decided by the method, not the
 * caller.
 *
 * @example
 *
 * ```ts
 * import type { PublishParameters } from "@bedrock/ocale/places";
 *
 * const params: PublishParameters = {
 *     body: new Uint8Array([0x3c, 0x72, 0x6f, 0x62, 0x6c, 0x6f, 0x78, 0x20]),
 *     format: "rbxlx",
 *     placeId: "456",
 *     universeId: "123",
 * };
 * expect(params.format).toBe("rbxlx");
 * ```
 */
export interface PublishParameters {
	/** Raw `.rbxl` or `.rbxlx` file bytes. Must be non-empty. */
	readonly body: Uint8Array<ArrayBuffer>;
	/**
	 * Whether `body` is the binary or XML place format. The transport
	 * sends `application/octet-stream` for `"rbxl"` and `application/xml`
	 * for `"rbxlx"`, and the builder rejects payloads whose magic bytes
	 * disagree with the declared format before any HTTP call.
	 */
	readonly format: "rbxl" | "rbxlx";
	/** Stringified ID of the place inside the universe. */
	readonly placeId: string;
	/** Stringified ID of the universe that owns the place. */
	readonly universeId: string;
}

/**
 * Successful response from publishing or saving a new place version.
 *
 * @example
 *
 * ```ts
 * import type { PlaceVersion } from "@bedrock/ocale/places";
 *
 * const version: PlaceVersion = { versionNumber: 42 };
 * expect(version.versionNumber).toBeGreaterThan(0);
 * ```
 */
export interface PlaceVersion {
	/**
	 * Auto-incrementing version number assigned by Roblox. Always at least
	 * `1` for the first publish; increases by one for every subsequent
	 * publish or save against the same place.
	 */
	readonly versionNumber: number;
}
