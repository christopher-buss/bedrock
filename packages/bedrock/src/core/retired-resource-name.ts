const MANTLE_TIMESTAMP_SUFFIX = /(?:\.000)?Z/;

/**
 * Returns Mantle's deprecated name with a UTC timestamp.
 *
 * @param now - Time to record in the deprecated name.
 * @returns Deprecated name with Mantle's UTC timestamp format.
 */
export function retiredResourceName(now: Date): string {
	const timestamp = now.toISOString().replace("T", " ").replace(MANTLE_TIMESTAMP_SUFFIX, "");
	return `zzz_DEPRECATED(${timestamp})`;
}

/**
 * Listing fields that hide a retired game pass or developer product.
 *
 * @param now - Time to record in the deprecated name.
 * @returns Deprecated name, empty description and off-sale flag.
 */
export function retiredListing(now: Date): {
	readonly description: "";
	readonly isForSale: false;
	readonly name: string;
} {
	return { name: retiredResourceName(now), description: "", isForSale: false };
}
