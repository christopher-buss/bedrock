import { describe, expect, it } from "vitest";

import type { HttpRequest } from "../../client/types.ts";
import { isUploadRequest } from "./upload-request.ts";

describe(isUploadRequest, () => {
	it("should treat a FormData body as an upload request", () => {
		expect.assertions(1);

		const request = {
			body: new FormData(),
			method: "POST",
			url: "/upload",
		} satisfies HttpRequest;

		expect(isUploadRequest(request)).toBeTrue();
	});

	it("should treat a Uint8Array body as an upload request", () => {
		expect.assertions(1);

		const request = {
			body: new Uint8Array([1, 2, 3]),
			method: "POST",
			url: "/upload",
		} satisfies HttpRequest;

		expect(isUploadRequest(request)).toBeTrue();
	});

	it("should not treat a JSON body as an upload request", () => {
		expect.assertions(1);

		const request = { body: { name: "x" }, method: "POST", url: "/json" } satisfies HttpRequest;

		expect(isUploadRequest(request)).toBeFalse();
	});

	it("should not treat a body-less request as an upload request", () => {
		expect.assertions(1);

		const request = { method: "GET", url: "/json" } satisfies HttpRequest;

		expect(isUploadRequest(request)).toBeFalse();
	});
});
