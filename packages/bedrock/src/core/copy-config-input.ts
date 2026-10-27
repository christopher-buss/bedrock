/**
 * Detach declarative containers while retaining opaque plugin values.
 * @param input - Authored configuration data.
 * @param copies - Containers already copied, preserving cycles and aliases.
 * @returns Independent plain objects and arrays with opaque instances intact.
 */
export function copyConfigInput(input: unknown, copies = new WeakMap<object, object>()): unknown {
	if (!(input instanceof Object)) {
		return input;
	}

	const prototype = Object.getPrototypeOf(input);
	if (prototype !== Object.prototype && prototype !== Array.prototype) {
		return input;
	}

	const existing = copies.get(input);
	if (existing !== undefined) {
		return existing;
	}

	const copied: object = Array.isArray(input) ? Array.of<unknown>() : {};
	copies.set(input, copied);
	const descriptors = Object.getOwnPropertyDescriptors(input);
	for (const descriptor of Object.values(descriptors)) {
		if ("value" in descriptor) {
			descriptor.value = copyConfigInput(descriptor.value, copies);
		}
	}

	Object.defineProperties(copied, descriptors);
	return copied;
}
