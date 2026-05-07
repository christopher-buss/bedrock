import { assert, describe, expect, it } from "vitest";

import { buildUploadIconRequest } from "./builders.ts";
import type { UploadBadgeIconLocalizationParameters } from "./types.ts";

describe(buildUploadIconRequest, () => {
	it("should use the POST method", () => {
		expect.assertions(1);

		const parameters = {
			badgeId: "12345",
			image: new Uint8Array([1, 2, 3]),
			languageCode: "en-us",
		} satisfies UploadBadgeIconLocalizationParameters;

		const request = buildUploadIconRequest(parameters);

		expect(request.method).toBe("POST");
	});

	it("should interpolate badgeId and languageCode into the upload URL", () => {
		expect.assertions(1);

		const parameters = {
			badgeId: "12345",
			image: new Uint8Array([1, 2, 3]),
			languageCode: "fr-fr",
		} satisfies UploadBadgeIconLocalizationParameters;

		const request = buildUploadIconRequest(parameters);

		expect(request.url).toBe(
			"/legacy-game-internationalization/v1/badges/12345/icons/language-codes/fr-fr",
		);
	});

	it("should append the image as the `Files` field on a FormData body", () => {
		expect.assertions(1);

		const parameters = {
			badgeId: "12345",
			image: new Uint8Array([1, 2, 3]),
			languageCode: "en-us",
		} satisfies UploadBadgeIconLocalizationParameters;

		const request = buildUploadIconRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("Files")).toBeTrue();
	});

	it("should wrap a Uint8Array image into a Blob preserving its bytes", () => {
		expect.assertions(2);

		const image = new Uint8Array([1, 2, 3, 4]);
		const parameters = {
			badgeId: "12345",
			image,
			languageCode: "en-us",
		} satisfies UploadBadgeIconLocalizationParameters;

		const request = buildUploadIconRequest(parameters);

		assert(request.body instanceof FormData);

		const appended = request.body.get("Files");
		assert(appended instanceof Blob);

		expect(appended).toBeInstanceOf(Blob);
		expect(appended.size).toBe(image.byteLength);
	});

	it("should preserve the MIME type of a Blob image", () => {
		expect.assertions(1);

		const image = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
		const parameters = {
			badgeId: "12345",
			image,
			languageCode: "en-us",
		} satisfies UploadBadgeIconLocalizationParameters;

		const request = buildUploadIconRequest(parameters);

		assert(request.body instanceof FormData);

		const appended = request.body.get("Files");
		assert(appended instanceof Blob);

		expect(appended.type).toBe("image/png");
	});
});
