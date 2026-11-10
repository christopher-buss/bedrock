import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

import { applyPatchesToText, findObsoletePatchDescriptions } from "./apply-schema-patches.ts";

const VENDOR_SPEC_PATH = fileURLToPath(new URL("../vendor/roblox-openapi.json", import.meta.url));
const PUBLISH_JSON_CONTENT =
	'              "application/json": {\n                "schema": {\n                  "type": "object",\n                  "properties": {\n                    "versionNumber": {\n                      "type": "number"\n                    }\n                  },\n                  "required": ["versionNumber"]\n                }\n              },\n';
const QUEUE_REQUIRED_UPSTREAM = '"MemoryStoreQueueItem": {\n        "type": "object",';
const QUEUE_REQUIRED_PATCHED = `${QUEUE_REQUIRED_UPSTREAM}\n        "required": ["data"],`;
const QUEUE_PATH_UPSTREAM = '{memory_store_queue_item_id}`",\n            "nullable": true,';
const QUEUE_PATH_PATCHED = `${QUEUE_PATH_UPSTREAM}\n            "readOnly": true,`;
const QUEUE_PATH_EXAMPLE =
	'"example": "cloud/v2/universes/123/memory-store/queues/some-memory-store-queue-id/items/some-memory-store-queue-item-id"';
const QUEUE_PATH_EXAMPLE_READ_ONLY = `${QUEUE_PATH_EXAMPLE},\n            "readOnly": true`;
const BADGE_PAGE_PATCH = "Badges page response cursors become nullable";
const PUBLISH_PATCH = "Places_CreatePlaceVersionApiKey adds the captured application/json response";
const PUBLISH_PATCH_ERROR =
	"failed to apply patch: Places_CreatePlaceVersionApiKey adds the captured application/json response";

/**
 * Returns the vendored spec as if upstream had fixed the queue path
 * drift by appending `readOnly` after the field's example. The patch's
 * pre-patch regex still matches this text.
 *
 * @returns The modified spec text.
 */
function readQueuePathFixedUpstream(): string {
	return readFileSync(VENDOR_SPEC_PATH, "utf8")
		.replace(QUEUE_PATH_PATCHED, () => QUEUE_PATH_UPSTREAM)
		.replace(QUEUE_PATH_EXAMPLE, () => QUEUE_PATH_EXAMPLE_READ_ONLY);
}

describe(findObsoletePatchDescriptions, () => {
	it("should flag every patch when the input contains none of the pre-patch shapes", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(findObsoletePatchDescriptions("")).toStrictEqual([
			"MemoryStoreQueueItem.required gains 'data'",
			"MemoryStoreQueueItem.properties.path becomes readOnly",
			"GetGameIconResponse.imageId becomes nullable",
			"BadgeAwarder type becomes the string enum Place",
			BADGE_PAGE_PATCH,
			PUBLISH_PATCH,
		]);
	});

	it("should flag every patch when run against the post-patch vendored spec", ({ expect }) => {
		// The committed vendor spec is the post-patch state, so each
		// patch's `find` regex (which matches the pre-patch shape) no
		// longer matches. Verifying this gives a strong signal that
		// the patches genuinely transform the upstream into the post-
		// patch shape rather than landing as no-ops.
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");

		expect(findObsoletePatchDescriptions(text)).toHaveLength(6);
	});

	it("should not flag a patch when its pre-patch shape is present in the input", ({ expect }) => {
		// Reintroduce the pre-patch shape for the queue path patch: the
		// field loses `"readOnly": true`. The other patches' shapes remain
		// absent, so they still flag.
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");
		const reverted = text.replace(QUEUE_PATH_PATCHED, () => QUEUE_PATH_UPSTREAM);

		expect(findObsoletePatchDescriptions(reverted)).not.toContain(
			"MemoryStoreQueueItem.properties.path becomes readOnly",
		);
	});

	it("should flag a patch whose pre-patch shape matches but whose fix upstream already ships elsewhere in the object", ({
		expect,
	}) => {
		// Upstream adds the fix at a position the pre-patch regex does not
		// look at, so the regex still matches. Applying the patch would
		// then write a second `readOnly` key into the same object.
		expect.assertions(1);

		expect(findObsoletePatchDescriptions(readQueuePathFixedUpstream())).toContain(
			"MemoryStoreQueueItem.properties.path becomes readOnly",
		);
	});
});

describe(applyPatchesToText, () => {
	it("should reject a patch that would write a key the object already has", ({ expect }) => {
		expect.assertions(1);

		expect(() => applyPatchesToText(readQueuePathFixedUpstream())).toThrow(
			"failed to apply patch: MemoryStoreQueueItem.properties.path becomes readOnly (duplicate key; upstream may already ship the fix)",
		);
	});

	it("should report every patch as already applied on the post-patch vendored spec", ({
		expect,
	}) => {
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");

		expect(applyPatchesToText(text)).toStrictEqual({ already: 6, applied: 0, text });
	});

	it("should re-apply reverted patches and reproduce the committed spec byte-for-byte", ({
		expect,
	}) => {
		// Reverts both queue patches and checks the apply pass restores the
		// committed post-patch state exactly. Both payloads wrap `$1`/`$2`
		// group references, so a byte-for-byte round-trip proves the
		// references expand instead of landing as literal `$n` tokens. That
		// pins the 2026-08 regression where a function replacer
		// (`() => patch.replace`) inserted the payload verbatim, corrupted
		// the queue schema on the first patch, and broke every subsequent
		// patch in the weekly refresh flow.
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");
		const reverted = text
			.replace(QUEUE_REQUIRED_PATCHED, () => QUEUE_REQUIRED_UPSTREAM)
			.replace(QUEUE_PATH_PATCHED, () => QUEUE_PATH_UPSTREAM);

		expect(applyPatchesToText(reverted)).toStrictEqual({ already: 4, applied: 2, text });
	});

	it("should re-apply the reverted game-icon and badge awarder patches byte-for-byte", ({
		expect,
	}) => {
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");
		const reverted = text
			.replace(
				'GetGameIconResponse": {\n        "type": "object",\n        "properties": {\n          "imageId": {\n            "type": "string",\n            "nullable": true',
				'GetGameIconResponse": {\n        "type": "object",\n        "properties": {\n          "imageId": {\n            "type": "string"',
			)
			.replace(
				'          "type": {\n            "enum": ["Place"],\n            "type": "string"',
				'          "type": {\n            "format": "int32",\n            "description": " [\'Place\' = 1]",\n            "enum": [1],\n            "type": "integer"',
			);

		expect(applyPatchesToText(reverted)).toStrictEqual({ already: 4, applied: 2, text });
	});

	it("should re-apply the reverted badge page cursor patch byte-for-byte", ({ expect }) => {
		expect.assertions(2);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");
		const reverted = text.replace(
			'"Roblox.Web.WebAPI.Models.ApiPageResponse_Roblox.Badges.Api.BadgeResponse_": {\n        "type": "object",\n        "properties": {\n          "previousPageCursor": {\n            "type": "string",\n            "nullable": true\n          },\n          "nextPageCursor": {\n            "type": "string",\n            "nullable": true\n          },',
			'"Roblox.Web.WebAPI.Models.ApiPageResponse_Roblox.Badges.Api.BadgeResponse_": {\n        "type": "object",\n        "properties": {\n          "previousPageCursor": {\n            "type": "string"\n          },\n          "nextPageCursor": {\n            "type": "string"\n          },',
		);

		expect(reverted).not.toBe(text);
		expect(applyPatchesToText(reverted)).toStrictEqual({ already: 5, applied: 1, text });
	});

	it("should restore the captured publish JSON schema without changing text/plain or other operations", ({
		expect,
	}) => {
		expect.assertions(3);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8");
		const reverted = text.replace(PUBLISH_JSON_CONTENT, "");

		expect(findObsoletePatchDescriptions(reverted)).not.toContain(PUBLISH_PATCH);
		expect(applyPatchesToText(reverted)).toStrictEqual({ already: 5, applied: 1, text });
		expect(findObsoletePatchDescriptions(text)).toContain(PUBLISH_PATCH);
	});

	it("should reject an unexpected publish JSON version type instead of accepting the applied marker", ({
		expect,
	}) => {
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8").replace(PUBLISH_JSON_CONTENT, () => {
			return PUBLISH_JSON_CONTENT.replace('"type": "number"', '"type": "string"');
		});

		expect(() => applyPatchesToText(text)).toThrow(PUBLISH_PATCH_ERROR);
	});

	it("should reject an unexpected publish text/plain schema instead of overwriting it", ({
		expect,
	}) => {
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8")
			.replace(PUBLISH_JSON_CONTENT, "")
			.replace(
				/("description": "Returns the published place's version number\.",\n {12}"content": \{\n {14}"text\/plain": \{\n {16}"schema": \{\n {18})"type": "string"/,
				'$1"type": "boolean"',
			);

		expect(() => applyPatchesToText(text)).toThrow(PUBLISH_PATCH_ERROR);
	});

	it("should reject an unrecognized publish response instead of patching a later operation", ({
		expect,
	}) => {
		expect.assertions(1);

		const text = readFileSync(VENDOR_SPEC_PATH, "utf8").replace(PUBLISH_JSON_CONTENT, "");
		const operationStart = text.indexOf('"operationId": "Places_CreatePlaceVersionApiKey"');
		const responsesStart = text.indexOf('        "responses": {', operationStart);
		const responsesEnd = text.indexOf('        "security": [', responsesStart);
		const laterResponse = text.slice(responsesStart, responsesEnd);
		const unrecognized = text.replace(
			'"description": "Returns the published place\'s version number."',
			'"description": "Unrecognized publish response."',
		);

		expect(() => applyPatchesToText(unrecognized + laterResponse)).toThrow(PUBLISH_PATCH_ERROR);
	});

	it("should throw when a patch matches neither its pre-patch shape nor its applied marker", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(() => applyPatchesToText("")).toThrow(
			"failed to apply patch: MemoryStoreQueueItem.required gains 'data'",
		);
	});
});
