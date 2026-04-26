import { assert, describe, expect, it } from "vitest";

import {
	buildDeleteIconRequest,
	buildListIconsRequest,
	buildUploadIconRequest,
} from "./builders.ts";
import type {
	DeleteExperienceIconParameters,
	ListExperienceIconsParameters,
	UploadExperienceIconParameters,
} from "./types.ts";

describe(buildUploadIconRequest, () => {
	it("should use the POST method", () => {
		expect.assertions(1);

		const parameters = {
			image: new Uint8Array([1, 2, 3]),
			languageCode: "en-us",
			universeId: "67890",
		} satisfies UploadExperienceIconParameters;

		const request = buildUploadIconRequest(parameters);

		expect(request.method).toBe("POST");
	});

	it("should interpolate universeId and languageCode into the upload URL", () => {
		expect.assertions(1);

		const parameters = {
			image: new Uint8Array([1, 2, 3]),
			languageCode: "fr-fr",
			universeId: "67890",
		} satisfies UploadExperienceIconParameters;

		const request = buildUploadIconRequest(parameters);

		expect(request.url).toBe(
			"/legacy-game-internationalization/v1/game-icon/games/67890/language-codes/fr-fr",
		);
	});

	it("should append the image as the `request.files` field on a FormData body", () => {
		expect.assertions(1);

		const parameters = {
			image: new Uint8Array([1, 2, 3]),
			languageCode: "en-us",
			universeId: "67890",
		} satisfies UploadExperienceIconParameters;

		const request = buildUploadIconRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("request.files")).toBeTrue();
	});

	it("should wrap a Uint8Array image into a Blob preserving its bytes", () => {
		expect.assertions(2);

		const image = new Uint8Array([1, 2, 3, 4]);
		const parameters = {
			image,
			languageCode: "en-us",
			universeId: "67890",
		} satisfies UploadExperienceIconParameters;

		const request = buildUploadIconRequest(parameters);

		assert(request.body instanceof FormData);
		const appended = request.body.get("request.files");
		assert(appended instanceof Blob);

		expect(appended).toBeInstanceOf(Blob);
		expect(appended.size).toBe(image.byteLength);
	});

	it("should preserve the MIME type of a Blob image", () => {
		expect.assertions(1);

		const image = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
		const parameters = {
			image,
			languageCode: "en-us",
			universeId: "67890",
		} satisfies UploadExperienceIconParameters;

		const request = buildUploadIconRequest(parameters);

		assert(request.body instanceof FormData);
		const appended = request.body.get("request.files");
		assert(appended instanceof Blob);

		expect(appended.type).toBe("image/png");
	});
});

describe(buildDeleteIconRequest, () => {
	it("should use the DELETE method", () => {
		expect.assertions(1);

		const parameters = {
			languageCode: "en-us",
			universeId: "67890",
		} satisfies DeleteExperienceIconParameters;

		const request = buildDeleteIconRequest(parameters);

		expect(request.method).toBe("DELETE");
	});

	it("should interpolate universeId and languageCode into the delete URL", () => {
		expect.assertions(1);

		const parameters = {
			languageCode: "es-es",
			universeId: "67890",
		} satisfies DeleteExperienceIconParameters;

		const request = buildDeleteIconRequest(parameters);

		expect(request.url).toBe(
			"/legacy-game-internationalization/v1/game-icon/games/67890/language-codes/es-es",
		);
	});

	it("should not set a body", () => {
		expect.assertions(1);

		const parameters = {
			languageCode: "en-us",
			universeId: "67890",
		} satisfies DeleteExperienceIconParameters;

		const request = buildDeleteIconRequest(parameters);

		expect(request.body).toBeUndefined();
	});
});

describe(buildListIconsRequest, () => {
	it("should use the GET method", () => {
		expect.assertions(1);

		const parameters = { universeId: "67890" } satisfies ListExperienceIconsParameters;

		const request = buildListIconsRequest(parameters);

		expect(request.method).toBe("GET");
	});

	it("should interpolate universeId into the list URL", () => {
		expect.assertions(1);

		const parameters = { universeId: "67890" } satisfies ListExperienceIconsParameters;

		const request = buildListIconsRequest(parameters);

		expect(request.url).toBe("/legacy-game-internationalization/v1/game-icon/games/67890");
	});

	it("should not set a body", () => {
		expect.assertions(1);

		const parameters = { universeId: "67890" } satisfies ListExperienceIconsParameters;

		const request = buildListIconsRequest(parameters);

		expect(request.body).toBeUndefined();
	});
});
