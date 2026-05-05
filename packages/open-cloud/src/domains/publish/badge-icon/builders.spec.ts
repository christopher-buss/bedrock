import { assert, describe, expect, it } from "vitest";

import { buildUploadIconRequest } from "./builders.ts";
import type { UploadBadgeIconParameters } from "./types.ts";

describe(buildUploadIconRequest, () => {
	it("should use the POST method", () => {
		expect.assertions(1);

		const parameters = {
			badgeId: "12345",
			icon: new Uint8Array([1, 2, 3]),
		} satisfies UploadBadgeIconParameters;

		const request = buildUploadIconRequest(parameters);

		expect(request.method).toBe("POST");
	});

	it("should interpolate badgeId into the upload URL", () => {
		expect.assertions(1);

		const parameters = {
			badgeId: "12345",
			icon: new Uint8Array([1, 2, 3]),
		} satisfies UploadBadgeIconParameters;

		const request = buildUploadIconRequest(parameters);

		expect(request.url).toBe("/legacy-publish/v1/badges/12345/icon");
	});

	it("should append the icon as the `Files` field on a FormData body", () => {
		expect.assertions(1);

		const parameters = {
			badgeId: "12345",
			icon: new Uint8Array([1, 2, 3]),
		} satisfies UploadBadgeIconParameters;

		const request = buildUploadIconRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("Files")).toBeTrue();
	});

	it("should wrap a Uint8Array icon into a Blob preserving its bytes", () => {
		expect.assertions(2);

		const icon = new Uint8Array([1, 2, 3, 4]);
		const parameters = {
			badgeId: "12345",
			icon,
		} satisfies UploadBadgeIconParameters;

		const request = buildUploadIconRequest(parameters);

		assert(request.body instanceof FormData);

		const appended = request.body.get("Files");
		assert(appended instanceof Blob);

		expect(appended).toBeInstanceOf(Blob);
		expect(appended.size).toBe(icon.byteLength);
	});

	it("should preserve the MIME type of a Blob icon", () => {
		expect.assertions(1);

		const icon = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
		const parameters = {
			badgeId: "12345",
			icon,
		} satisfies UploadBadgeIconParameters;

		const request = buildUploadIconRequest(parameters);

		assert(request.body instanceof FormData);

		const appended = request.body.get("Files");
		assert(appended instanceof Blob);

		expect(appended.type).toBe("image/png");
	});
});
