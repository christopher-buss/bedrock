import { assert, describe, it } from "vitest";

import {
	buildCreateRequest,
	buildGetRequest,
	buildListRequest,
	buildUpdateRequest,
} from "./builders.ts";
import type {
	CreateGamePassParameters,
	GetGamePassParameters,
	ListGamePassesParameters,
	UpdateGamePassParameters,
} from "./types.ts";

describe(buildGetRequest, () => {
	it("should use the GET method", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			gamePassId: "12345",
			universeId: "67890",
		} satisfies GetGamePassParameters;

		const request = buildGetRequest(parameters);

		expect(request.method).toBe("GET");
	});

	it("should interpolate universeId and gamePassId into the creator URL", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			gamePassId: "12345",
			universeId: "67890",
		} satisfies GetGamePassParameters;

		const request = buildGetRequest(parameters);

		expect(request.url).toBe("/game-passes/v1/universes/67890/game-passes/12345/creator");
	});

	it("should not set a body", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			gamePassId: "12345",
			universeId: "67890",
		} satisfies GetGamePassParameters;

		const request = buildGetRequest(parameters);

		expect(request.body).toBeUndefined();
	});
});

describe(buildCreateRequest, () => {
	it("should use the POST method", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(parameters);

		expect(request.method).toBe("POST");
	});

	it("should interpolate universeId into the create URL", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(parameters);

		expect(request.url).toBe("/game-passes/v1/universes/67890/game-passes");
	});

	it("should append name to a FormData body", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.get("name")).toBe("Epic Pass");
	});

	it("should append description when provided", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			name: "Epic Pass",
			description: "Unlocks epic stuff",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.get("description")).toBe("Unlocks epic stuff");
	});

	it("should omit description when not provided", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("description")).toBeFalse();
	});

	it.for<[field: "isForSale" | "isManagedPricingEnabled", value: boolean, expected: string]>([
		["isForSale", true, "true"],
		["isForSale", false, "false"],
		["isManagedPricingEnabled", true, "true"],
		["isManagedPricingEnabled", false, "false"],
	])(
		"should stringify %s=%s into the form body as %j",
		([field, value, expected], { expect }) => {
			expect.assertions(1);

			const parameters = {
				name: "Epic Pass",
				[field]: value,
				universeId: "67890",
			} satisfies CreateGamePassParameters;

			const request = buildCreateRequest(parameters);

			assert(request.body instanceof FormData);

			expect(request.body.get(field)).toBe(expected);
		},
	);

	it.for<[field: "isForSale" | "isManagedPricingEnabled"]>([
		["isForSale"],
		["isManagedPricingEnabled"],
	])("should omit %s from the create form body when not provided", ([field], { expect }) => {
		expect.assertions(1);

		const parameters = {
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has(field)).toBeFalse();
	});

	it("should stringify price into the form body when provided", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			name: "Epic Pass",
			price: 100,
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.get("price")).toBe("100");
	});

	it("should omit price when not provided", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("price")).toBeFalse();
	});

	it("should wrap a Uint8Array imageFile into a Blob preserving its bytes", ({ expect }) => {
		expect.assertions(2);

		const imageFile = new Uint8Array([1, 2, 3, 4]);
		const parameters = {
			name: "Epic Pass",
			imageFile,
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);
		const appended = request.body.get("imageFile");
		assert(appended instanceof Blob);

		expect(appended).toBeInstanceOf(Blob);
		expect(appended.size).toBe(imageFile.byteLength);
	});

	it("should preserve the MIME type of a Blob imageFile", ({ expect }) => {
		expect.assertions(2);

		const imageFile = new Blob([new Uint8Array([1, 2, 3, 4])], {
			type: "image/png",
		});
		const parameters = {
			name: "Epic Pass",
			imageFile,
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);
		const appended = request.body.get("imageFile");
		assert(appended instanceof Blob);

		expect(appended).toBeInstanceOf(Blob);
		expect(appended.type).toBe("image/png");
	});

	it("should omit imageFile when not provided", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			name: "Epic Pass",
			universeId: "67890",
		} satisfies CreateGamePassParameters;

		const request = buildCreateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("imageFile")).toBeFalse();
	});
});

describe(buildUpdateRequest, () => {
	it("should use the PATCH method", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			gamePassId: "12345",
			universeId: "67890",
		} satisfies UpdateGamePassParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.method).toBe("PATCH");
	});

	it("should interpolate universeId and gamePassId into the URL", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			gamePassId: "12345",
			universeId: "67890",
		} satisfies UpdateGamePassParameters;

		const request = buildUpdateRequest(parameters);

		expect(request.url).toBe("/game-passes/v1/universes/67890/game-passes/12345");
	});

	it("should produce an empty FormData body when only identifiers are supplied", ({ expect }) => {
		expect.assertions(2);

		const parameters = {
			gamePassId: "12345",
			universeId: "67890",
		} satisfies UpdateGamePassParameters;

		const request = buildUpdateRequest(parameters);

		assert(request.body instanceof FormData);

		expect([...request.body.keys()]).toBeEmpty();
		expect(request.body.has("name")).toBeFalse();
	});

	it.for<[field: keyof UpdateGamePassParameters, value: unknown, expected: string]>([
		["name", "Epic Pass", "Epic Pass"],
		["description", "Unlocks epic stuff", "Unlocks epic stuff"],
		["isForSale", true, "true"],
		["isForSale", false, "false"],
		["isManagedPricingEnabled", true, "true"],
		["isManagedPricingEnabled", false, "false"],
		["price", 100, "100"],
	])(
		"should append %s=%j to the form body when provided",
		([field, value, expected], { expect }) => {
			expect.assertions(1);

			const parameters = {
				[field]: value,
				gamePassId: "12345",
				universeId: "67890",
			} satisfies UpdateGamePassParameters;

			const request = buildUpdateRequest(parameters);

			assert(request.body instanceof FormData);

			expect(request.body.get(field)).toBe(expected);
		},
	);

	it.for<[field: Exclude<keyof UpdateGamePassParameters, "imageFile">]>([
		["name"],
		["description"],
		["isForSale"],
		["isManagedPricingEnabled"],
		["price"],
	])("should omit %s from the form body when not provided", ([field], { expect }) => {
		expect.assertions(1);

		const parameters = {
			gamePassId: "12345",
			universeId: "67890",
		} satisfies UpdateGamePassParameters;

		const request = buildUpdateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has(field)).toBeFalse();
	});

	it("should omit the wire `file` field when imageFile is not provided", ({ expect }) => {
		expect.assertions(2);

		const parameters = {
			gamePassId: "12345",
			universeId: "67890",
		} satisfies UpdateGamePassParameters;

		const request = buildUpdateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("file")).toBeFalse();
		expect(request.body.has("imageFile")).toBeFalse();
	});

	it("should append imageFile under the wire's `file` multipart field name", ({ expect }) => {
		expect.assertions(2);

		const imageFile = new Uint8Array([1, 2, 3, 4]);
		const parameters = {
			gamePassId: "12345",
			imageFile,
			universeId: "67890",
		} satisfies UpdateGamePassParameters;

		const request = buildUpdateRequest(parameters);

		assert(request.body instanceof FormData);

		expect(request.body.has("file")).toBeTrue();
		expect(request.body.has("imageFile")).toBeFalse();
	});

	it("should wrap a Uint8Array imageFile into a Blob preserving its bytes", ({ expect }) => {
		expect.assertions(2);

		const imageFile = new Uint8Array([1, 2, 3, 4]);
		const parameters = {
			gamePassId: "12345",
			imageFile,
			universeId: "67890",
		} satisfies UpdateGamePassParameters;

		const request = buildUpdateRequest(parameters);

		assert(request.body instanceof FormData);
		const appended = request.body.get("file");
		assert(appended instanceof Blob);

		expect(appended).toBeInstanceOf(Blob);
		expect(appended.size).toBe(imageFile.byteLength);
	});

	it("should preserve the MIME type of a Blob imageFile", ({ expect }) => {
		expect.assertions(2);

		const imageFile = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
		const parameters = {
			gamePassId: "12345",
			imageFile,
			universeId: "67890",
		} satisfies UpdateGamePassParameters;

		const request = buildUpdateRequest(parameters);

		assert(request.body instanceof FormData);
		const appended = request.body.get("file");
		assert(appended instanceof Blob);

		expect(appended).toBeInstanceOf(Blob);
		expect(appended.type).toBe("image/png");
	});
});

describe(buildListRequest, () => {
	it("should use the GET method", ({ expect }) => {
		expect.assertions(1);

		const parameters = { universeId: "67890" } satisfies ListGamePassesParameters;

		const request = buildListRequest(parameters);

		expect(request.method).toBe("GET");
	});

	it("should target the creator list URL with no query string when no cursors are provided", ({
		expect,
	}) => {
		expect.assertions(1);

		const parameters = { universeId: "67890" } satisfies ListGamePassesParameters;

		const request = buildListRequest(parameters);

		expect(request.url).toBe("/game-passes/v1/universes/67890/game-passes/creator");
	});

	it("should not set a body", ({ expect }) => {
		expect.assertions(1);

		const parameters = { universeId: "67890" } satisfies ListGamePassesParameters;

		const request = buildListRequest(parameters);

		expect(request.body).toBeUndefined();
	});

	it("should append pageSize when provided", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			pageSize: 25,
			universeId: "67890",
		} satisfies ListGamePassesParameters;

		const request = buildListRequest(parameters);

		expect(request.url).toBe("/game-passes/v1/universes/67890/game-passes/creator?pageSize=25");
	});

	it("should append pageToken when provided", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			pageToken: "cursor",
			universeId: "67890",
		} satisfies ListGamePassesParameters;

		const request = buildListRequest(parameters);

		expect(request.url).toBe(
			"/game-passes/v1/universes/67890/game-passes/creator?pageToken=cursor",
		);
	});

	it("should append both pageSize and pageToken when both are provided", ({ expect }) => {
		expect.assertions(1);

		const parameters = {
			pageSize: 10,
			pageToken: "cursor",
			universeId: "67890",
		} satisfies ListGamePassesParameters;

		const request = buildListRequest(parameters);

		expect(request.url).toBe(
			"/game-passes/v1/universes/67890/game-passes/creator?pageSize=10&pageToken=cursor",
		);
	});
});
