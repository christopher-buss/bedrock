import type { UpdatePlaceParameters } from "#src/domains/cloud-v2/places/types";
import { describe, expect, expectTypeOf, it } from "vitest";

import { listWritablePropertyNames } from "./_helpers.ts";

/**
 * Hand-mirrored set of every writable field exposed by
 * `UpdatePlaceParameters`. Source-of-truth for two paired checks:
 *
 * - the type-level pin asserts the array is exhaustive against the
 *   parameter interface (minus the `placeId` and `universeId` URL
 *   fields), so a new parameter cannot land without an entry here;
 * - the runtime drift check asserts every entry is non-`readOnly` on
 *   the OpenAPI `Place` schema, so an entry cannot name a server-side
 *   readOnly field.
 */
const UPDATE_PLACE_PARAMETER_KEYS = ["description", "displayName", "serverSize"] as const;

type UpdatePlaceParameterKey = (typeof UPDATE_PLACE_PARAMETER_KEYS)[number];

// Type-level pin: every key in the parameter interface (minus the
// placeId and universeId URL fields) must appear in the const array,
// and the array must not name a key that is not in the interface.
expectTypeOf<UpdatePlaceParameterKey>().toEqualTypeOf<
	Exclude<keyof UpdatePlaceParameters, "placeId" | "universeId">
>();

describe("updatePlaceParameters writable-keys pin", () => {
	it.for(UPDATE_PLACE_PARAMETER_KEYS)(
		"should expose %s as a non-readOnly property on the Place schema",
		(key) => {
			expect.assertions(1);
			expect(listWritablePropertyNames("Place")).toContain(key);
		},
	);
});
