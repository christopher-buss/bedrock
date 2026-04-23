import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../errors/api-error.ts";
import { parseExperienceResponse } from "./parsers.ts";
import type { UniverseWire } from "./wire.ts";

function validUniverseBody(overrides: Partial<UniverseWire> = {}): UniverseWire {
	return {
		ageRating: "AGE_RATING_13_PLUS",
		consoleEnabled: false,
		createTime: "2024-01-15T10:30:00.000Z",
		description: "A sample experience.",
		desktopEnabled: true,
		displayName: "My Experience",
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

function okResponse(body: UniverseWire): Parameters<typeof parseExperienceResponse>[0] {
	return { body, headers: {}, status: 200 };
}

describe(parseExperienceResponse, () => {
	it("should parse a full valid body into the public Experience shape", () => {
		expect.assertions(1);

		const result = parseExperienceResponse(okResponse(validUniverseBody()));

		assert(result.success);

		expect(result.data).toStrictEqual({
			id: "12345",
			ageRating: "13Plus",
			consoleEnabled: false,
			createdAt: new Date("2024-01-15T10:30:00.000Z"),
			description: "A sample experience.",
			desktopEnabled: true,
			discordSocialLink: undefined,
			displayName: "My Experience",
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

			const result = parseExperienceResponse(
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

			const result = parseExperienceResponse(
				okResponse(validUniverseBody({ voiceChatEnabled: undefined })),
			);

			assert(result.success);

			expect(result.data.voiceChatEnabled).toBeFalse();
		});

		it("should surface privateServerPriceRobux as undefined when omitted", () => {
			expect.assertions(1);

			const result = parseExperienceResponse(
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

			const result = parseExperienceResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data.privateServerPriceRobux).toBeUndefined();
		});

		it("should surface rootPlaceId as undefined when rootPlace is omitted", () => {
			expect.assertions(1);

			const result = parseExperienceResponse(
				okResponse(validUniverseBody({ rootPlace: undefined })),
			);

			assert(result.success);

			expect(result.data.rootPlaceId).toBeUndefined();
		});

		it("should surface each social link as its public shape when present", () => {
			expect.assertions(2);

			const result = parseExperienceResponse(
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

			const result = parseExperienceResponse(
				okResponse(validUniverseBody({ path: "universes/99999999999" })),
			);

			assert(result.success);

			expect(result.data.id).toBe("99999999999");
		});

		it("should extract the numeric root place ID from the rootPlace path", () => {
			expect.assertions(1);

			const result = parseExperienceResponse(
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

			const result = parseExperienceResponse(
				okResponse(validUniverseBody({ path: "places/123" })),
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.message).toBe("Malformed experience response");
		});
	});

	describe("enum mapping", () => {
		it.for([
			{ expected: "public" as const, wire: "PUBLIC" as const },
			{ expected: "private" as const, wire: "PRIVATE" as const },
			{ expected: "unspecified" as const, wire: "VISIBILITY_UNSPECIFIED" as const },
		])("should map visibility $wire to $expected", ({ expected, wire }) => {
			expect.assertions(1);

			const result = parseExperienceResponse(
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

			const result = parseExperienceResponse(
				okResponse(validUniverseBody({ ageRating: wire })),
			);

			assert(result.success);

			expect(result.data.ageRating).toBe(expected);
		});
	});

	describe("owner resolution", () => {
		it("should produce a user-kind owner when `user` is present", () => {
			expect.assertions(1);

			const result = parseExperienceResponse(
				okResponse(validUniverseBody({ group: undefined, user: "users/999" })),
			);

			assert(result.success);

			expect(result.data.owner).toStrictEqual({ id: "999", kind: "user" });
		});

		it("should produce a group-kind owner when only `group` is present", () => {
			expect.assertions(1);

			const result = parseExperienceResponse(
				okResponse(validUniverseBody({ group: "groups/42", user: undefined })),
			);

			assert(result.success);

			expect(result.data.owner).toStrictEqual({ id: "42", kind: "group" });
		});

		it("should reject a body with neither user nor group as malformed", () => {
			expect.assertions(2);

			const result = parseExperienceResponse(
				okResponse(validUniverseBody({ group: undefined, user: undefined })),
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.statusCode).toBe(200);
		});

		it("should reject an owner resource path that does not match users/{id} or groups/{id}", () => {
			expect.assertions(1);

			const result = parseExperienceResponse(
				okResponse(validUniverseBody({ group: undefined, user: "accounts/7777" })),
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should prefer the user field over the group field when both are present", () => {
			expect.assertions(1);

			const result = parseExperienceResponse(
				okResponse(validUniverseBody({ group: "groups/42", user: "users/999" })),
			);

			assert(result.success);

			expect(result.data.owner.kind).toBe("user");
		});
	});

	describe("malformed bodies", () => {
		it("should reject a non-record body", () => {
			expect.assertions(2);

			const result = parseExperienceResponse({
				body: "not an object",
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.statusCode).toBe(200);
		});

		it("should reject a body missing the required `path` field", () => {
			expect.assertions(1);

			const { path: _path, ...rest } = validUniverseBody();
			const result = parseExperienceResponse({ body: rest, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose visibility is not a recognized enum value", () => {
			expect.assertions(1);

			const body = { ...validUniverseBody(), visibility: "SOMETHING_ELSE" };
			const result = parseExperienceResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose ageRating is not a recognized enum value", () => {
			expect.assertions(1);

			const body = { ...validUniverseBody(), ageRating: "AGE_RATING_99_PLUS" };
			const result = parseExperienceResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose social link is not a well-formed object", () => {
			expect.assertions(1);

			const body = {
				...validUniverseBody(),
				facebookSocialLink: { title: "Facebook", uri: 123 },
			};
			const result = parseExperienceResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose privateServerPriceRobux is not a number", () => {
			expect.assertions(1);

			const body = { ...validUniverseBody(), privateServerPriceRobux: "free" };
			const result = parseExperienceResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should propagate the response status code on the returned ApiError", () => {
			expect.assertions(1);

			const result = parseExperienceResponse({ body: "nope", headers: {}, status: 502 });

			assert(!result.success);

			expect(result.err.statusCode).toBe(502);
		});
	});
});
