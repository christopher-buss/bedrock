/**
 * Augments the global Headers interface with iterable methods.
 *
 * Better-typescript-lib@2.12.0 splits these into a separate iterable.d.ts
 * that tsgo's libReplacement mode does not load. This file bridges the gap
 * until better-typescript-lib ships a fix or is no longer needed.
 *
 * @see https://github.com/uhyo/better-typescript-lib
 */
interface Headers {
	[Symbol.iterator](): IterableIterator<[string, string]>;
	/** Returns an iterator allowing to go through all key/value pairs contained in this object. */
	entries(): IterableIterator<[string, string]>;
	/** Returns an iterator allowing to go through all keys of the key/value pairs contained in this object. */
	keys(): IterableIterator<string>;
	/** Returns an iterator allowing to go through all values of the key/value pairs contained in this object. */
	values(): IterableIterator<string>;
}
