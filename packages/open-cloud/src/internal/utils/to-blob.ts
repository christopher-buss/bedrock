/**
 * Wraps a binary value as a {@link Blob}, copying `Uint8Array` input into a
 * fresh `Blob` so the originating buffer cannot be mutated between request
 * build and send. `Blob` input is returned as-is so MIME-type metadata is
 * preserved.
 *
 * @param value - Binary data to convert.
 * @returns The supplied `Blob`, or a new `Blob` wrapping a defensive copy.
 */
export function toBlob(value: Blob | Uint8Array): Blob {
	if (value instanceof Blob) {
		return value;
	}

	return new Blob([new Uint8Array(value)]);
}
