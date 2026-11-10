import type { OpenCloudError, Page, Result } from "@bedrock-rbx/ocale";
import type {
	GetPlaceParameters,
	ListPlacesParameters,
	Place,
	PlacesClient,
	PlaceSummary,
} from "@bedrock-rbx/ocale/places";

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

	it("should accept only the page sizes the endpoint allows", () => {
		expectTypeOf<ListPlacesParameters["pageSize"]>().toEqualTypeOf<
			10 | 25 | 50 | 100 | undefined
		>();
		expectTypeOf<ReturnType<PlacesClient["list"]>>().toEqualTypeOf<
			Promise<Result<Page<PlaceSummary>, OpenCloudError>>
		>();
	});
});
