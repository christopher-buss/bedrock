import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";
import type { GetPlaceParameters, Place, PlacesClient } from "@bedrock-rbx/ocale/places";

import { describe, expectTypeOf, it } from "vitest";

describe("place read API", () => {
	it("should expose readonly identifiers and return the genuine Place root flag", () => {
		expectTypeOf<GetPlaceParameters>().toEqualTypeOf<{
			readonly placeId: string;
			readonly universeId: string;
		}>();
		expectTypeOf<ReturnType<PlacesClient["get"]>>().toEqualTypeOf<
			Promise<Result<Place, OpenCloudError>>
		>();
	});
});
