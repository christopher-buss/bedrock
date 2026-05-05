import type { BadgeResponseV2Wire } from "#src/domains/badges/badges/wire";

/**
 * Builds a minimally-valid {@link BadgeResponseV2Wire} body. Pass an
 * `overrides` object to tweak individual fields while keeping everything
 * else schema-compliant; useful for parser and integration tests that
 * only care about one field at a time.
 *
 * @param overrides - Fields to override on the default body.
 * @returns A valid wire body with the overrides applied.
 */
export function validBadgeBody(overrides: Partial<BadgeResponseV2Wire> = {}): BadgeResponseV2Wire {
	return {
		id: 12_345,
		name: "First Goal",
		awarder: { id: 222, name: "Lobby", type: 1 },
		created: "2024-01-15T10:30:00.000Z",
		description: "Awarded on first login.",
		displayDescription: "Awarded on first login.",
		displayIconImageId: 67_890,
		displayName: "First Goal",
		enabled: true,
		iconImageId: 67_890,
		statistics: { awardedCount: 100, pastDayAwardedCount: 5, winRatePercentage: 42.5 },
		updated: "2024-03-20T14:45:00.000Z",
		...overrides,
	};
}
