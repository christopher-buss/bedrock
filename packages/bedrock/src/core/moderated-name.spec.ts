import { describe, it } from "vitest";

import {
	developerProductCurrent,
	developerProductDesired,
	gamePassCurrent,
	gamePassDesired,
} from "#tests/helpers/resources";
import { findModeratedName } from "./moderated-name.ts";

describe(findModeratedName, () => {
	it("should return the submitted and stored names when a developer product name differs", ({
		expect,
	}) => {
		expect.assertions(1);

		expect(
			findModeratedName(
				developerProductDesired({ name: "Gem Pack 12345" }),
				developerProductCurrent({ name: "##############" }),
			),
		).toStrictEqual({ stored: "##############", submitted: "Gem Pack 12345" });
	});

	it("should return undefined when the developer product name matches", ({ expect }) => {
		expect.assertions(1);

		expect(
			findModeratedName(developerProductDesired(), developerProductCurrent()),
		).toBeUndefined();
	});

	it("should return undefined for a kind other than developer product", ({ expect }) => {
		expect.assertions(2);

		expect(
			findModeratedName(gamePassDesired({ name: "A" }), gamePassCurrent({ name: "B" })),
		).toBeUndefined();
		expect(
			findModeratedName(
				developerProductDesired({ name: "A" }),
				gamePassCurrent({ name: "B" }),
			),
		).toBeUndefined();
	});
});
