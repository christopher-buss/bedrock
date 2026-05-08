// Applies known drift corrections to `vendor/roblox-openapi.json` after a
// fresh upstream pull. Each patch addresses a confirmed divergence between
// Roblox's published schema and the live API at `apis.roblox.com`. The
// patches are idempotent: each one is a no-op when its target shape is
// already present, so callers may invoke this after every refresh without
// checking intermediate state. See `vendor/README.md` ("Local drift
// patches") for the rationale and verification dates.
//
// String-surgery is preferred over `JSON.parse` + `JSON.stringify` so the
// upstream formatting (compact short arrays, key ordering, whitespace)
// survives the patch step. Diffs against the previous pinned commit show
// only the five patched fields, not a whole-file reformat.

const SPEC_PATH = "vendor/roblox-openapi.json";

interface Patch {
	/** Marker that the patched output produces; idempotency check. */
	readonly appliedMarker: string;
	readonly description: string;
	readonly find: RegExp;
	readonly replace: string;
}

const PATCHES: ReadonlyArray<Patch> = [
	{
		appliedMarker: '"required": ["data"]\n      },\n      "MemoryStoreSortedMapItem":',
		description: "MemoryStoreQueueItem.required gains 'data'",
		find: /("MemoryStoreQueueItem": \{[\s\S]*?"x-oneOf": \{\n {10}"expiration": \["ttl", "expireTime"\]\n {8}\})\n( {6}\})/,
		replace: '$1,\n        "required": ["data"]\n$2',
	},
	{
		appliedMarker: '{memory_store_queue_item_id}`",\n            "readOnly": true',
		description: "MemoryStoreQueueItem.properties.path becomes readOnly",
		find: /("MemoryStoreQueueItem":[\s\S]*?\{memory_store_queue_item_id\}`")\n( {10}\})/,
		replace: '$1,\n            "readOnly": true\n$2',
	},
	{
		appliedMarker: '"queueItems":',
		description: "ReadMemoryStoreQueueItemsResponse renames items→queueItems and readId→id",
		find: /("ReadMemoryStoreQueueItemsResponse": \{\n {8}"type": "object",\n {8}"properties": \{)\n( {10})"readId":(\s*\{[\s\S]*?\n {10}\},)\n {10}"items":(\s*\{[\s\S]*?\n {10}\})/,
		replace: '$1\n$2"id":$3\n          "queueItems":$4',
	},
	{
		// Anchored on the priority field that immediately precedes ttl so
		// the marker is unique to MemoryStoreQueueItem (MemoryStoreSortedMapItem
		// also ends with `"The TTL for the item."` followed by `expireTime`,
		// but has no priority field).
		appliedMarker:
			'"description": "The priority of the queue item.",\n            "format": "double"\n          },\n          "ttl": {\n            "writeOnly": true,\n            "example": "3s",\n            "type": "string",\n            "description": "The TTL for the item."\n          },\n          "expireTime"',
		description: "MemoryStoreQueueItem.ttl drops invalid format: duration",
		find: /(\{memory_store_queue_item_id\}`",[\s\S]*?"description": "The TTL for the item\.")(,\n {12}"format": "duration")/,
		replace: "$1",
	},
	{
		appliedMarker:
			'"name": "invisibilityWindow",\n            "in": "query",\n            "description": "Invisibility window for items read',
		description:
			"Cloud_ReadMemoryStoreQueueItems.invisibilityWindow drops invalid format: duration",
		find: /("name": "invisibilityWindow",[\s\S]*?"example": "3s",\n {14}"type": "string")(,\n {14}"format": "duration")/,
		replace: "$1",
	},
];

/**
 * Applies the documented drift corrections to `vendor/roblox-openapi.json`.
 * Reads the file as text, applies each patch in turn via a targeted
 * regex replacement, and writes the result back. Each patch is idempotent:
 * when the find regex no longer matches, the script confirms that the
 * patched marker is present and continues. If neither matches, the
 * upstream schema has changed in a way the patch can no longer find, and
 * the script throws so the divergence is caught at refresh time.
 *
 * @rejects {Error} If a patch's find regex no longer matches and its
 *   applied-marker is also absent, indicating the upstream schema has
 *   shifted under the patch in a way the script cannot reconcile.
 */
export async function applySchemaPatches(): Promise<void> {
	const original = await Bun.file(SPEC_PATH).text();
	let text = original;
	let applied = 0;
	let already = 0;

	for (const patch of PATCHES) {
		const next = text.replace(patch.find, patch.replace);
		if (next !== text) {
			text = next;
			applied += 1;
			continue;
		}

		if (text.includes(patch.appliedMarker)) {
			already += 1;
			continue;
		}

		throw new Error(
			`failed to apply patch: ${patch.description} (upstream schema may have changed)`,
		);
	}

	if (applied > 0) {
		await Bun.write(SPEC_PATH, text);
		const noun = applied === 1 ? "patch" : "patches";
		console.log(`apply-schema-patches: applied ${applied} ${noun}`);
		return;
	}

	console.log(`apply-schema-patches: no changes (${already} already applied)`);
}

if (import.meta.main) {
	await applySchemaPatches();
}
