import type { RobloxLanguageCode, RobloxLocale } from "#src/locales/index";
import { describe, expectTypeOf, it } from "vitest";

import type { DeleteExperienceIconParameters, UploadExperienceIconParameters } from "./index.ts";

describe("UploadExperienceIconParameters", () => {
	it("should require universeId, languageCode, and image", () => {
		expectTypeOf<UploadExperienceIconParameters>().toExtend<{
			image: Blob | Uint8Array;
			languageCode: RobloxLanguageCode | RobloxLocale;
			universeId: string;
		}>();
	});

	it.for(["en", "en_us"] as const)(
		"should accept %s as a Roblox wire form on languageCode",
		(code) => {
			const parameters: UploadExperienceIconParameters = {
				image: new Uint8Array([1]),
				languageCode: code,
				universeId: "999",
			};

			expectTypeOf(parameters).toExtend<UploadExperienceIconParameters>();
		},
	);

	it("should reject BCP-47 strings on languageCode at compile time", () => {
		const parameters: UploadExperienceIconParameters = {
			image: new Uint8Array([1]),
			// @ts-expect-error -- BCP-47 like `en-us` is not a Roblox wire form.
			languageCode: "en-us",
			universeId: "999",
		};

		expectTypeOf(parameters).toExtend<UploadExperienceIconParameters>();
	});
});

describe("DeleteExperienceIconParameters", () => {
	it("should require universeId and languageCode", () => {
		expectTypeOf<DeleteExperienceIconParameters>().toExtend<{
			languageCode: RobloxLanguageCode | RobloxLocale;
			universeId: string;
		}>();
	});

	it.for(["en", "en_us"] as const)(
		"should accept %s as a Roblox wire form on languageCode",
		(code) => {
			const parameters: DeleteExperienceIconParameters = {
				languageCode: code,
				universeId: "999",
			};

			expectTypeOf(parameters).toExtend<DeleteExperienceIconParameters>();
		},
	);

	it("should reject BCP-47 strings on languageCode at compile time", () => {
		const parameters: DeleteExperienceIconParameters = {
			// @ts-expect-error -- BCP-47 like `fr-fr` is not a Roblox wire form.
			languageCode: "fr-fr",
			universeId: "999",
		};

		expectTypeOf(parameters).toExtend<DeleteExperienceIconParameters>();
	});
});
