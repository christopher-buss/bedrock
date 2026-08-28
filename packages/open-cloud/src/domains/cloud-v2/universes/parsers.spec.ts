import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../../errors/api-error.ts";
import { parseUniverseResponse } from "./parsers.ts";
import type { UniverseWire } from "./wire.ts";

function validUniverseBody(overrides: Partial<UniverseWire> = {}): UniverseWire {
	return {
		ageRating: "AGE_RATING_13_PLUS",
		consoleEnabled: false,
		createTime: "2024-01-15T10:30:00.000Z",
		description: "A sample universe.",
		desktopEnabled: true,
		displayName: "My Universe",
		mobileEnabled: true,
		path: "universes/12345",
		privateServerPriceRobux: 25,
		rootPlace: "universes/12345/places/98765",
		tabletEnabled: true,
		updateTime: "2024-11-02T17:08:21.500Z",
		user: "users/7777",
		visibility: "PUBLIC",
		voiceChatEnabled: true,
		vrEnabled: false,
		...overrides,
	};
}

function okResponse(body: UniverseWire): Parameters<typeof parseUniverseResponse>[0] {
	return { body, headers: {}, status: 200 };
}

describe(parseUniverseResponse, () => {
	it("should parse a full valid body into the public Universe shape", () => {
		expect.assertions(1);

		const result = parseUniverseResponse(okResponse(validUniverseBody()));

		assert(result.success);

		expect(result.data).toStrictEqual({
			id: "12345",
			ageRating: "13Plus",
			consoleEnabled: false,
			createdAt: new Date("2024-01-15T10:30:00.000Z"),
			description: "A sample universe.",
			desktopEnabled: true,
			discordSocialLink: undefined,
			displayName: "My Universe",
			facebookSocialLink: undefined,
			guildedSocialLink: undefined,
			mobileEnabled: true,
			owner: { id: "7777", kind: "user" },
			privateServerPriceRobux: 25,
			robloxGroupSocialLink: undefined,
			rootPlaceId: "98765",
			tabletEnabled: true,
			twitchSocialLink: undefined,
			twitterSocialLink: undefined,
			updatedAt: new Date("2024-11-02T17:08:21.500Z"),
			visibility: "public",
			voiceChatEnabled: true,
			vrEnabled: false,
			youtubeSocialLink: undefined,
		});
	});

	describe("optional normalization", () => {
		it("should default missing playable-device booleans to false", () => {
			expect.assertions(5);

			const result = parseUniverseResponse(
				okResponse(
					validUniverseBody({
						consoleEnabled: undefined,
						desktopEnabled: undefined,
						mobileEnabled: undefined,
						tabletEnabled: undefined,
						vrEnabled: undefined,
					}),
				),
			);

			assert(result.success);

			expect(result.data.desktopEnabled).toBeFalse();
			expect(result.data.mobileEnabled).toBeFalse();
			expect(result.data.tabletEnabled).toBeFalse();
			expect(result.data.consoleEnabled).toBeFalse();
			expect(result.data.vrEnabled).toBeFalse();
		});

		it("should default missing voiceChatEnabled to false", () => {
			expect.assertions(1);

			const result = parseUniverseResponse(
				okResponse(validUniverseBody({ voiceChatEnabled: undefined })),
			);

			assert(result.success);

			expect(result.data.voiceChatEnabled).toBeFalse();
		});

		it("should surface privateServerPriceRobux as undefined when omitted", () => {
			expect.assertions(1);

			const result = parseUniverseResponse(
				okResponse(validUniverseBody({ privateServerPriceRobux: undefined })),
			);

			assert(result.success);

			expect(result.data.privateServerPriceRobux).toBeUndefined();
		});

		it("should normalize a JSON null privateServerPriceRobux to undefined", () => {
			expect.assertions(1);

			// JSON.parse("null") dodges the `unicorn/no-null` source rule
			// while still producing the literal null value at runtime. We
			// widen the body to Record<string, unknown> so the null slips
			// past the `T | undefined` wire annotation while still hitting
			// the parser, which accepts `unknown` at runtime.
			const body: Record<string, unknown> = {
				...validUniverseBody(),
				privateServerPriceRobux: JSON.parse("null"),
			};

			const result = parseUniverseResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data.privateServerPriceRobux).toBeUndefined();
		});

		it("should surface rootPlaceId as undefined when rootPlace is omitted", () => {
			expect.assertions(1);

			const result = parseUniverseResponse(
				okResponse(validUniverseBody({ rootPlace: undefined })),
			);

			assert(result.success);

			expect(result.data.rootPlaceId).toBeUndefined();
		});

		it("should normalize a JSON null voiceChatEnabled to false", () => {
			expect.assertions(1);

			const body: Record<string, unknown> = {
				...validUniverseBody(),
				voiceChatEnabled: JSON.parse("null"),
			};

			const result = parseUniverseResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data.voiceChatEnabled).toBeFalse();
		});

		it("should normalize a JSON null social link to undefined", () => {
			expect.assertions(1);

			const body: Record<string, unknown> = {
				...validUniverseBody(),
				facebookSocialLink: JSON.parse("null"),
			};

			const result = parseUniverseResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data.facebookSocialLink).toBeUndefined();
		});

		it("should surface each social link as its public shape when present", () => {
			expect.assertions(2);

			const result = parseUniverseResponse(
				okResponse(
					validUniverseBody({
						discordSocialLink: { title: "Discord", uri: "https://discord.gg/example" },
						facebookSocialLink: {
							title: "Facebook",
							uri: "https://facebook.com/example",
						},
					}),
				),
			);

			assert(result.success);

			expect(result.data.facebookSocialLink).toStrictEqual({
				title: "Facebook",
				uri: "https://facebook.com/example",
			});
			expect(result.data.discordSocialLink).toStrictEqual({
				title: "Discord",
				uri: "https://discord.gg/example",
			});
		});
	});

	describe("id extraction", () => {
		it("should extract the numeric universe ID from the resource path", () => {
			expect.assertions(1);

			const result = parseUniverseResponse(
				okResponse(validUniverseBody({ path: "universes/99999999999" })),
			);

			assert(result.success);

			expect(result.data.id).toBe("99999999999");
		});

		it("should extract the numeric root place ID from the rootPlace path", () => {
			expect.assertions(1);

			const result = parseUniverseResponse(
				okResponse(
					validUniverseBody({
						rootPlace: "universes/123/places/456789",
					}),
				),
			);

			assert(result.success);

			expect(result.data.rootPlaceId).toBe("456789");
		});

		it("should reject a body whose path does not match the universes/{id} pattern", () => {
			expect.assertions(2);

			const result = parseUniverseResponse(
				okResponse(validUniverseBody({ path: "places/123" })),
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.message).toBe("Malformed universe response");
		});
	});

	describe("enum mapping", () => {
		it.for([
			{ expected: "public" as const, wire: "PUBLIC" as const },
			{ expected: "private" as const, wire: "PRIVATE" as const },
			{ expected: "unspecified" as const, wire: "VISIBILITY_UNSPECIFIED" as const },
		])("should map visibility $wire to $expected", ({ expected, wire }) => {
			expect.assertions(1);

			const result = parseUniverseResponse(
				okResponse(validUniverseBody({ visibility: wire })),
			);

			assert(result.success);

			expect(result.data.visibility).toBe(expected);
		});

		it.for([
			{ expected: "all" as const, wire: "AGE_RATING_ALL" as const },
			{ expected: "9Plus" as const, wire: "AGE_RATING_9_PLUS" as const },
			{ expected: "13Plus" as const, wire: "AGE_RATING_13_PLUS" as const },
			{ expected: "17Plus" as const, wire: "AGE_RATING_17_PLUS" as const },
			{ expected: "unspecified" as const, wire: "AGE_RATING_UNSPECIFIED" as const },
		])("should map ageRating $wire to $expected", ({ expected, wire }) => {
			expect.assertions(1);

			const result = parseUniverseResponse(
				okResponse(validUniverseBody({ ageRating: wire })),
			);

			assert(result.success);

			expect(result.data.ageRating).toBe(expected);
		});
	});

	describe("owner resolution", () => {
		it("should produce a user-kind owner when `user` is present", () => {
			expect.assertions(1);

			const result = parseUniverseResponse(
				okResponse(validUniverseBody({ group: undefined, user: "users/999" })),
			);

			assert(result.success);

			expect(result.data.owner).toStrictEqual({ id: "999", kind: "user" });
		});

		it("should produce a group-kind owner when only `group` is present", () => {
			expect.assertions(1);

			const result = parseUniverseResponse(
				okResponse(validUniverseBody({ group: "groups/42", user: undefined })),
			);

			assert(result.success);

			expect(result.data.owner).toStrictEqual({ id: "42", kind: "group" });
		});

		it("should reject a body with neither user nor group as malformed", () => {
			expect.assertions(2);

			const result = parseUniverseResponse(
				okResponse(validUniverseBody({ group: undefined, user: undefined })),
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.statusCode).toBe(200);
		});

		it("should reject an owner resource path that does not match users/{id} or groups/{id}", () => {
			expect.assertions(1);

			const result = parseUniverseResponse(
				okResponse(validUniverseBody({ group: undefined, user: "accounts/7777" })),
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should prefer the user field over the group field when both are present", () => {
			expect.assertions(1);

			const result = parseUniverseResponse(
				okResponse(validUniverseBody({ group: "groups/42", user: "users/999" })),
			);

			assert(result.success);

			expect(result.data.owner.kind).toBe("user");
		});
	});

	describe("malformed bodies", () => {
		it("should reject a non-record body", () => {
			expect.assertions(2);

			const result = parseUniverseResponse({
				body: "not an object",
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.statusCode).toBe(200);
		});

		it("should carry the offending body on the malformed-response error", () => {
			expect.assertions(1);

			const result = parseUniverseResponse({
				body: { unexpected: true },
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err.details).toStrictEqual({ unexpected: true });
		});

		it("should reject a body missing the required `path` field", () => {
			expect.assertions(1);

			const { path: _path, ...rest } = validUniverseBody();
			const result = parseUniverseResponse({ body: rest, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose visibility is not a recognized enum value", () => {
			expect.assertions(1);

			const body = { ...validUniverseBody(), visibility: "SOMETHING_ELSE" };
			const result = parseUniverseResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose ageRating is not a recognized enum value", () => {
			expect.assertions(1);

			const body = { ...validUniverseBody(), ageRating: "AGE_RATING_99_PLUS" };
			const result = parseUniverseResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it.for([
			"facebookSocialLink",
			"twitterSocialLink",
			"youtubeSocialLink",
			"twitchSocialLink",
			"discordSocialLink",
			"robloxGroupSocialLink",
			"guildedSocialLink",
		] as const)("should reject a body whose %s carries a non-string uri", (field) => {
			expect.assertions(1);

			const body = { ...validUniverseBody(), [field]: { title: "Link", uri: 123 } };
			const result = parseUniverseResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a social link whose title is not a string", () => {
			expect.assertions(1);

			const body = {
				...validUniverseBody(),
				facebookSocialLink: { title: 123, uri: "https://facebook.com/example" },
			};
			const result = parseUniverseResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a social link that is not an object", () => {
			expect.assertions(1);

			const body = {
				...validUniverseBody(),
				facebookSocialLink: "https://facebook.com/example",
			};
			const result = parseUniverseResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it.for([
			"voiceChatEnabled",
			"desktopEnabled",
			"mobileEnabled",
			"tabletEnabled",
			"consoleEnabled",
			"vrEnabled",
		] as const)("should reject a body whose %s is not a boolean", (field) => {
			expect.assertions(1);

			const body = { ...validUniverseBody(), [field]: "yes" };
			const result = parseUniverseResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it.for(["displayName", "description"] as const)(
			"should reject a body whose %s is not a string",
			(field) => {
				expect.assertions(1);

				const body = { ...validUniverseBody(), [field]: 123 };
				const result = parseUniverseResponse({ body, headers: {}, status: 200 });

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
			},
		);

		it("should reject a body whose rootPlace is not a string", () => {
			expect.assertions(1);

			const body = { ...validUniverseBody(), rootPlace: 98765 };
			const result = parseUniverseResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a non-string path that stringifies to a valid resource path", () => {
			expect.assertions(1);

			// A single-element array stringifies to that element, so the
			// universes/{id} pattern matches once the string check is past.
			const body = { ...validUniverseBody(), path: ["universes/555"] };
			const result = parseUniverseResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject an array body even when it carries every universe field", () => {
			expect.assertions(1);

			// An array carrying named properties keeps the class tag
			// `[object Array]`, which the record discriminator reads before
			// any field check runs.
			const body = Object.assign([], validUniverseBody());
			const result = parseUniverseResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it.for(["createTime", "updateTime"] as const)(
			"should reject a body whose %s is a string that does not parse to a Date",
			(field) => {
				expect.assertions(2);

				const body = { ...validUniverseBody(), [field]: "not-a-date" };
				const result = parseUniverseResponse({ body, headers: {}, status: 200 });

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
				expect(result.err.message).toBe("Malformed universe response");
			},
		);

		it("should reject a body whose privateServerPriceRobux is not a number", () => {
			expect.assertions(1);

			const body = { ...validUniverseBody(), privateServerPriceRobux: "free" };
			const result = parseUniverseResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should propagate the response status code on the returned ApiError", () => {
			expect.assertions(1);

			const result = parseUniverseResponse({ body: "nope", headers: {}, status: 502 });

			assert(!result.success);

			expect(result.err.statusCode).toBe(502);
		});
	});
});
