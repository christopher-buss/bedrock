export type {
	Badge,
	BadgeAwarder,
	BadgeAwarderType,
	BadgePaymentSource,
	BadgeStatistics,
	CreateBadgeParameters,
	UpdateBadgeParameters,
} from "../../domains/badges/badges/types.ts";
export type { GetFreeBadgeQuotaParameters } from "../../domains/badges/free-quota/types.ts";
export type { UploadBadgeIconLocalizationParameters } from "../../domains/game-internationalization/badge-icon/types.ts";
export type { UpdateBadgeNameDescriptionParameters } from "../../domains/game-internationalization/badge-name-description/types.ts";
export type {
	UploadBadgeIconParameters,
	UploadedBadgeIcon,
} from "../../domains/publish/badge-icon/types.ts";
export { BadgesClient } from "./client.ts";
