import { assert, describe, it } from "vitest";

import { universeCurrent, universeDesired } from "#tests/helpers/resources";
import { asRobloxAssetId } from "../types/ids.ts";
import { diff } from "./diff.ts";
import { flattenConfig } from "./flatten.ts";
import { validateConfig } from "./schema.ts";
import { resolveEnvironment } from "./select-environment.ts";

describe("universe visibility", () => {
	it.for(["public", "private"] as const)(
		"should reconcile %s when adopting a different universe",
		(visibility, { expect }) => {
			expect.hasAssertions();

			const desired = universeDesired({ universeId: asRobloxAssetId("222"), visibility });
			const current = universeCurrent({ universeId: asRobloxAssetId("111"), visibility });

			expect(diff([desired], [current])[0]).toMatchObject({
				changedFields: ["visibility", "universeId"],
				type: "update",
			});
		},
	);

	it.for(["public", "private"] as const)(
		"should resolve and flatten %s visibility",
		(visibility, { expect }) => {
			expect.hasAssertions();

			const config = validateConfig(
				{ environments: { production: {} }, universe: { universeId: "123", visibility } },
				"config.ts",
			);
			assert(config.success);
			const resolved = resolveEnvironment(config.data, "production");
			assert(resolved.success);

			expect(flattenConfig(resolved.data.config)[0]).toMatchObject({ visibility });
		},
	);

	it.for([JSON.parse("null"), undefined, "none", "unspecified", "friends"])(
		"should reject explicit invalid visibility %s",
		(visibility, { expect }) => {
			expect.hasAssertions();
			expect(
				validateConfig(
					{
						environments: { production: {} },
						universe: { universeId: "123", visibility },
					},
					"config.ts",
				).success,
			).toBeFalse();
		},
	);

	it("should inherit root visibility and override it per environment", ({ expect }) => {
		expect.hasAssertions();

		const config = validateConfig(
			{
				environments: { production: {}, staging: { universe: { visibility: "private" } } },
				universe: { universeId: "123", visibility: "public" },
			},
			"config.ts",
		);
		assert(config.success);
		const production = resolveEnvironment(config.data, "production");
		const staging = resolveEnvironment(config.data, "staging");
		assert(production.success && staging.success);

		expect(production.data.config.universe!.visibility).toBe("public");
		expect(staging.data.config.universe!.visibility).toBe("private");
	});

	it("should reconcile adoption and changed visibility while trusting a confirmed noop", ({
		expect,
	}) => {
		expect.hasAssertions();

		const desired = universeDesired({ visibility: "public" });

		expect(diff([desired], [universeCurrent()])[0]).toMatchObject({
			changedFields: ["visibility"],
			type: "update",
		});
		expect(diff([desired], [universeCurrent({ visibility: "private" })])[0]).toMatchObject({
			changedFields: ["visibility"],
			type: "update",
		});
		expect(diff([desired], [universeCurrent({ visibility: "public" })])[0]).toMatchObject({
			type: "noop",
		});
		expect(
			diff([universeDesired()], [universeCurrent({ visibility: "public" })])[0],
		).toMatchObject({ type: "noop" });
	});
});
