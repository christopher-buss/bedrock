import type { UpdateGamePassParameters } from "#src/domains/game-passes/game-passes/types";
import { assert, describe, expect, expectTypeOf, it } from "vitest";

import { getOpenApiDocument, isRecord } from "./_helpers.ts";

/**
 * Hand-mirrored set of every writable field exposed by
 * `UpdateGamePassParameters`. Source-of-truth for two paired checks:
 *
 * - the type-level pin asserts the array is exhaustive against the
 *   parameter interface (minus the `gamePassId` and `universeId` URL
 *   fields), so a new parameter cannot land without an entry here;
 * - the runtime drift check asserts every entry maps to a property on
 *   the OpenAPI multipart schema for the update endpoint, so an entry
 *   cannot name a wire field the upstream API does not recognize.
 *
 * Multipart bodies have no `readOnly` flags on the inline schema, so
 * the writable-keys pin used for `$ref`-based bodies (Cloud_Update*
 * resources) does not apply here; this spec is the multipart-aware
 * equivalent.
 */
const UPDATE_GAME_PASS_KEYS = [
	"description",
	"imageFile",
	"isForSale",
	"isRegionalPricingEnabled",
	"name",
	"price",
] as const;

type UpdateGamePassKey = (typeof UPDATE_GAME_PASS_KEYS)[number];

// Type-level pin: every key in the parameter interface (minus the
// gamePassId and universeId URL fields) must appear in the const array,
// and the array must not name a key that is not in the interface.
expectTypeOf<UpdateGamePassKey>().toEqualTypeOf<
	Exclude<keyof UpdateGamePassParameters, "gamePassId" | "universeId">
>();

// `imageFile` on the parameter interface maps to `file` on the OpenAPI
// multipart schema (the create endpoint uses `imageFile`; update uses
// `file`). Every other parameter shares its name across both surfaces.
const WIRE_FIELD_BY_PARAMETER: Readonly<Record<UpdateGamePassKey, string>> = {
	name: "name",
	description: "description",
	imageFile: "file",
	isForSale: "isForSale",
	isRegionalPricingEnabled: "isRegionalPricingEnabled",
	price: "price",
};

describe("updateGamePassParameters multipart pin", () => {
	it.for(UPDATE_GAME_PASS_KEYS)(
		"should map %s to a multipart property on the update endpoint",
		(parameterKey) => {
			expect.assertions(1);

			const wireKey = WIRE_FIELD_BY_PARAMETER[parameterKey];

			expect(listMultipartProperties()).toContain(wireKey);
		},
	);
});

function listMultipartProperties(): ReadonlyArray<string> {
	const { paths } = getOpenApiDocument();
	assert(isRecord(paths));
	const path = paths["/game-passes/v1/universes/{universeId}/game-passes/{gamePassId}"];
	assert(isRecord(path));
	const { patch } = path;
	assert(isRecord(patch));
	const { requestBody } = patch;
	assert(isRecord(requestBody));
	const { content } = requestBody;
	assert(isRecord(content));
	const multipart = content["multipart/form-data"];
	assert(isRecord(multipart));
	const { schema } = multipart;
	assert(isRecord(schema));
	const { properties } = schema;
	assert(isRecord(properties));
	return Object.keys(properties);
}
