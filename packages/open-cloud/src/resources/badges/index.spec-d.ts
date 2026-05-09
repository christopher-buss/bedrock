import { describe, expectTypeOf, it } from "vitest";

import type { OpenCloudError } from "../../errors/base.ts";
import type { Result } from "../../types.ts";
import type {
	Badge,
	BadgeAwarderType,
	BadgePaymentSource,
	BadgesClient,
	CreateBadgeParameters,
	UpdateBadgeNameDescriptionParameters,
	UpdateBadgeParameters,
	UploadBadgeIconLocalizationParameters,
	UploadBadgeIconParameters,
} from "./index.ts";

describe("CreateBadgeParameters", () => {
	it("should require name, icon, and universeId", () => {
		expectTypeOf<CreateBadgeParameters>().toExtend<{
			icon: Blob | Uint8Array;
			name: string;
			universeId: string;
		}>();
	});

	it("should accept identifiers and icon without any optional fields", () => {
		const parameters: CreateBadgeParameters = {
			name: "First Goal",
			icon: new Uint8Array([1]),
			universeId: "999",
		};

		expectTypeOf(parameters).toExtend<CreateBadgeParameters>();
	});

	it("should accept every optional field", () => {
		const parameters: CreateBadgeParameters = {
			name: "First Goal",
			description: "Awarded on first login.",
			expectedCost: 100,
			icon: new Uint8Array([1]),
			isActive: true,
			paymentSource: "User",
			universeId: "999",
		};

		expectTypeOf(parameters).toExtend<CreateBadgeParameters>();
	});
});

describe("UpdateBadgeParameters", () => {
	it("should require badgeId", () => {
		expectTypeOf<UpdateBadgeParameters>().toExtend<{ badgeId: string }>();
	});

	it("should accept badgeId without any optional fields", () => {
		const parameters: UpdateBadgeParameters = { badgeId: "12345" };

		expectTypeOf(parameters).toExtend<UpdateBadgeParameters>();
	});

	it("should accept every writable field as optional", () => {
		const parameters: UpdateBadgeParameters = {
			name: "Renamed",
			badgeId: "12345",
			description: "renamed",
			enabled: false,
		};

		expectTypeOf(parameters).toExtend<UpdateBadgeParameters>();
	});
});

describe("UploadBadgeIconParameters", () => {
	it("should require badgeId and icon", () => {
		expectTypeOf<UploadBadgeIconParameters>().toExtend<{
			badgeId: string;
			icon: Blob | Uint8Array;
		}>();
	});
});

describe("UpdateBadgeNameDescriptionParameters", () => {
	it("should require badgeId and languageCode", () => {
		expectTypeOf<UpdateBadgeNameDescriptionParameters>().toExtend<{
			badgeId: string;
			languageCode: string;
		}>();
	});

	it("should accept identifiers without name or description", () => {
		const parameters: UpdateBadgeNameDescriptionParameters = {
			badgeId: "12345",
			languageCode: "fr_fr",
		};

		expectTypeOf(parameters).toExtend<UpdateBadgeNameDescriptionParameters>();
	});

	it("should accept name and description as optional fields", () => {
		const parameters: UpdateBadgeNameDescriptionParameters = {
			name: "Localized Goal",
			badgeId: "12345",
			description: "Awarded on first login.",
			languageCode: "fr_fr",
		};

		expectTypeOf(parameters).toExtend<UpdateBadgeNameDescriptionParameters>();
	});
});

describe("UploadBadgeIconLocalizationParameters", () => {
	it("should require badgeId, languageCode, and image", () => {
		expectTypeOf<UploadBadgeIconLocalizationParameters>().toExtend<{
			badgeId: string;
			image: Blob | Uint8Array;
			languageCode: string;
		}>();
	});
});

describe("Badge", () => {
	it("should expose stringified ids and Date timestamps", () => {
		expectTypeOf<Badge>().toExtend<{
			createdAt: Date;
			id: string;
			updatedAt: Date;
		}>();
	});
});

describe("BadgePaymentSource", () => {
	it("should be the union of User and Group", () => {
		expectTypeOf<BadgePaymentSource>().toEqualTypeOf<"Group" | "User">();
	});
});

describe("BadgeAwarderType", () => {
	it("should currently only allow Place", () => {
		expectTypeOf<BadgeAwarderType>().toEqualTypeOf<"Place">();
	});
});

describe("BadgesClient", () => {
	it("should resolve create() to Result<Badge, OpenCloudError>", () => {
		expectTypeOf<BadgesClient["create"]>().returns.resolves.toEqualTypeOf<
			Result<Badge, OpenCloudError>
		>();
	});

	it("should resolve update() to Result<undefined, OpenCloudError>", () => {
		expectTypeOf<BadgesClient["update"]>().returns.resolves.toEqualTypeOf<
			Result<undefined, OpenCloudError>
		>();
	});

	it("should resolve uploadIcon() to Result<undefined, OpenCloudError>", () => {
		expectTypeOf<BadgesClient["uploadIcon"]>().returns.resolves.toEqualTypeOf<
			Result<undefined, OpenCloudError>
		>();
	});

	it("should resolve localization.updateNameDescription() to Result<undefined, OpenCloudError>", () => {
		expectTypeOf<
			BadgesClient["localization"]["updateNameDescription"]
		>().returns.resolves.toEqualTypeOf<Result<undefined, OpenCloudError>>();
	});

	it("should resolve localization.uploadIcon() to Result<undefined, OpenCloudError>", () => {
		expectTypeOf<BadgesClient["localization"]["uploadIcon"]>().returns.resolves.toEqualTypeOf<
			Result<undefined, OpenCloudError>
		>();
	});
});
