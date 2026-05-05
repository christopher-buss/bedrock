import { assert, describe, expect, it } from "vitest";

import { buildCreateRequest, buildUpdateRequest } from "./builders.ts";
import type { CreateBadgeParameters, UpdateBadgeParameters } from "./types.ts";

describe(buildCreateRequest, () => {
	it("should use the POST method", () => {
		expect.assertions(1);

		const parameters = {
			name: "First Goal",
			icon: new Uint8Array([1, 2, 3]),
			universeId: "67890",
		} satisfies CreateBadgeParameters;

		const request = buildCreateRequest(parameters);

		expect(request.method).toBe("POST");
	});

	it("should interpolate universeId into the create URL", () => {
		expect.assertions(1);

		const parameters = {
			name: "First Goal",
			icon: new Uint8Array([1, 2, 3]),
			universeId: "67890",
		} satisfies CreateBadgeParameters;

		const request = buildCreateRequest(parameters);

		expect(request.url).toBe("/legacy-badges/v1/universes/67890/badges");
	});

	it("should append name to a FormData body", () => {
		expect.assertions(1);

		const parameters = {
			name: "First Goal",
			icon: new Uint8Array([1, 2, 3]),
			universeId: "67890",
		} satisfies CreateBadgeParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.get("name")).toBe("First Goal");
	});

	it("should append description when provided", () => {
		expect.assertions(1);

		const parameters = {
			name: "First Goal",
			description: "Awarded on first login.",
			icon: new Uint8Array([1, 2, 3]),
			universeId: "67890",
		} satisfies CreateBadgeParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.get("description")).toBe("Awarded on first login.");
	});

	it("should omit description when not provided", () => {
		expect.assertions(1);

		const parameters = {
			name: "First Goal",
			icon: new Uint8Array([1, 2, 3]),
			universeId: "67890",
		} satisfies CreateBadgeParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("description")).toBeFalse();
	});

	it.for<[isActive: boolean, expected: string]>([
		[true, "true"],
		[false, "false"],
	])("should stringify isActive=%s into the form body as %j", ([isActive, expected]) => {
		expect.assertions(1);

		const parameters = {
			name: "First Goal",
			icon: new Uint8Array([1, 2, 3]),
			isActive,
			universeId: "67890",
		} satisfies CreateBadgeParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.get("isActive")).toBe(expected);
	});

	it("should omit isActive when not provided", () => {
		expect.assertions(1);

		const parameters = {
			name: "First Goal",
			icon: new Uint8Array([1, 2, 3]),
			universeId: "67890",
		} satisfies CreateBadgeParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("isActive")).toBeFalse();
	});

	it("should stringify expectedCost into the form body when provided", () => {
		expect.assertions(1);

		const parameters = {
			name: "First Goal",
			expectedCost: 100,
			icon: new Uint8Array([1, 2, 3]),
			universeId: "67890",
		} satisfies CreateBadgeParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.get("expectedCost")).toBe("100");
	});

	it("should omit expectedCost when not provided", () => {
		expect.assertions(1);

		const parameters = {
			name: "First Goal",
			icon: new Uint8Array([1, 2, 3]),
			universeId: "67890",
		} satisfies CreateBadgeParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("expectedCost")).toBeFalse();
	});

	it.for<[paymentSource: "Group" | "User", expected: string]>([
		["User", "1"],
		["Group", "2"],
	])("should map paymentSource=%s to the wire integer %s", ([paymentSource, expected]) => {
		expect.assertions(1);

		const parameters = {
			name: "First Goal",
			icon: new Uint8Array([1, 2, 3]),
			paymentSource,
			universeId: "67890",
		} satisfies CreateBadgeParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.get("paymentSourceType")).toBe(expected);
	});

	it("should omit paymentSourceType when not provided", () => {
		expect.assertions(1);

		const parameters = {
			name: "First Goal",
			icon: new Uint8Array([1, 2, 3]),
			universeId: "67890",
		} satisfies CreateBadgeParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("paymentSourceType")).toBeFalse();
	});

	it("should wrap a Uint8Array icon into a Blob preserving its bytes on the `files` field", () => {
		expect.assertions(2);

		const icon = new Uint8Array([1, 2, 3, 4]);
		const parameters = {
			name: "First Goal",
			icon,
			universeId: "67890",
		} satisfies CreateBadgeParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);
		const appended = request.body.get("files");
		assert(appended instanceof Blob);

		expect(appended).toBeInstanceOf(Blob);
		expect(appended.size).toBe(icon.byteLength);
	});

	it("should preserve the MIME type of a Blob icon", () => {
		expect.assertions(1);

		const icon = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
		const parameters = {
			name: "First Goal",
			icon,
			universeId: "67890",
		} satisfies CreateBadgeParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);
		const appended = request.body.get("files");
		assert(appended instanceof Blob);

		expect(appended.type).toBe("image/png");
	});
});

describe(buildUpdateRequest, () => {
	it("should use the PATCH method", () => {
		expect.assertions(1);

		const parameters = {
			name: "Renamed",
			badgeId: "12345",
		} satisfies UpdateBadgeParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.method).toBe("PATCH");
	});

	it("should interpolate badgeId into the update URL", () => {
		expect.assertions(1);

		const parameters = {
			name: "Renamed",
			badgeId: "12345",
		} satisfies UpdateBadgeParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.url).toBe("/legacy-badges/v1/badges/12345");
	});

	it("should send a JSON body containing only the supplied fields", () => {
		expect.assertions(1);

		const parameters = {
			name: "First Goal",
			badgeId: "12345",
			description: "Awarded on first login.",
			enabled: true,
		} satisfies UpdateBadgeParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.body).toStrictEqual({
			name: "First Goal",
			description: "Awarded on first login.",
			enabled: true,
		});
	});

	it("should send only the explicitly supplied subset of fields", () => {
		expect.assertions(1);

		const parameters = {
			badgeId: "12345",
			enabled: false,
		} satisfies UpdateBadgeParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.body).toStrictEqual({ enabled: false });
	});

	it("should send an empty object when no writable field is supplied", () => {
		expect.assertions(1);

		const parameters = { badgeId: "12345" } satisfies UpdateBadgeParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.body).toStrictEqual({});
	});

	it.for<[enabled: boolean]>([[true], [false]])(
		"should preserve a literal enabled=%s in the JSON body without coercion",
		([enabled]) => {
			expect.assertions(1);

			const parameters = {
				badgeId: "12345",
				enabled,
			} satisfies UpdateBadgeParameters;

			const request = buildUpdateRequest(parameters);

			expect(request.body).toStrictEqual({ enabled });
		},
	);
});
