import { describe, expectTypeOf, it } from "vitest";

import { none } from "../core/none.ts";
import { defineConfig } from "./define-config.ts";

type Visibility = "private" | "public" | undefined;

describe("Universe visibility authoring", () => {
	it("should accept public and private visibility at the root and in environments", () => {
		const publicConfig = defineConfig({
			environments: { production: { universe: { visibility: "private" } } },
			universe: { universeId: "123", visibility: "public" },
		});
		const privateConfig = defineConfig({
			environments: { production: { universe: { visibility: "public" } } },
			universe: { universeId: "123", visibility: "private" },
		});

		expectTypeOf(publicConfig.universe!.visibility).toEqualTypeOf<Visibility>();
		expectTypeOf(
			publicConfig.environments["production"]!.universe!.visibility,
		).toEqualTypeOf<Visibility>();
		expectTypeOf(privateConfig.universe!.visibility).toEqualTypeOf<Visibility>();
		expectTypeOf(
			privateConfig.environments["production"]!.universe!.visibility,
		).toEqualTypeOf<Visibility>();
	});

	it("should accept omitted root and environment visibility", () => {
		const config = defineConfig({
			environments: { production: { universe: { displayName: "Production" } } },
			universe: { universeId: "123" },
		});

		expectTypeOf(config.universe!.visibility).toEqualTypeOf<Visibility>();
	});

	it("should reject unsupported root visibility strings", () => {
		const config = {
			environments: { production: {} },
			universe: { universeId: "123", visibility: "friends" },
		} as const;
		// @ts-expect-error -- visibility only accepts public or private
		defineConfig(config);
	});

	it("should reject boolean root visibility", () => {
		const config = {
			environments: { production: {} },
			universe: { universeId: "123", visibility: true },
		} as const;
		// @ts-expect-error -- visibility requires a supported string
		defineConfig(config);
	});

	it("should reject none as root visibility", () => {
		const config = {
			environments: { production: {} },
			universe: { universeId: "123", visibility: none },
		} as const;
		// @ts-expect-error -- visibility cannot be cleared with none
		defineConfig(config);
	});

	it("should reject unsupported environment visibility strings", () => {
		const config = {
			environments: { production: { universe: { visibility: "friends" } } },
			universe: { universeId: "123" },
		} as const;
		// @ts-expect-error -- visibility only accepts public or private
		defineConfig(config);
	});

	it("should reject boolean environment visibility", () => {
		const config = {
			environments: { production: { universe: { visibility: true } } },
			universe: { universeId: "123" },
		} as const;
		// @ts-expect-error -- environment visibility requires a supported string
		defineConfig(config);
	});

	it("should reject none as environment visibility", () => {
		const config = {
			environments: { production: { universe: { visibility: none } } },
			universe: { universeId: "123" },
		} as const;
		// @ts-expect-error -- environment visibility cannot be cleared with none
		defineConfig(config);
	});
});
