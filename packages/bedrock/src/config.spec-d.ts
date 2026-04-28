import { describe, expectTypeOf, it } from "vitest";

import * as ConfigModule from "./config.ts";
import type {
	Config,
	ConfigContext,
	ConfigInput,
	DeveloperProductEntry,
	EnvironmentEntry,
	GamePassEntry,
	GistStateConfig,
	PlaceEntry,
	ResolvedPlaceEntry,
	ResourceEntryByKind,
	SocialLink,
	StateConfig,
	UniverseEntry,
	UniverseVisibility,
} from "./config.ts";
import type * as Schema from "./core/schema.ts";
import type * as DefineConfig from "./shell/define-config.ts";

describe("@bedrock/core/config resource-entry re-exports", () => {
	it("should re-export Config with the same identity as core/schema", () => {
		expectTypeOf<Config>().toEqualTypeOf<Schema.Config>();
	});

	it("should re-export EnvironmentEntry with the same identity as core/schema", () => {
		expectTypeOf<EnvironmentEntry>().toEqualTypeOf<Schema.EnvironmentEntry>();
	});

	it("should re-export GamePassEntry with the same identity as core/schema", () => {
		expectTypeOf<GamePassEntry>().toEqualTypeOf<Schema.GamePassEntry>();
	});

	it("should re-export DeveloperProductEntry with the same identity as core/schema", () => {
		expectTypeOf<DeveloperProductEntry>().toEqualTypeOf<Schema.DeveloperProductEntry>();
	});

	it("should re-export PlaceEntry with the same identity as core/schema", () => {
		expectTypeOf<PlaceEntry>().toEqualTypeOf<Schema.PlaceEntry>();
	});

	it("should re-export ResolvedPlaceEntry with the same identity as core/schema", () => {
		expectTypeOf<ResolvedPlaceEntry>().toEqualTypeOf<Schema.ResolvedPlaceEntry>();
	});

	it("should re-export UniverseEntry with the same identity as core/schema", () => {
		expectTypeOf<UniverseEntry>().toEqualTypeOf<Schema.UniverseEntry>();
	});

	it("should re-export UniverseVisibility with the same identity as core/schema", () => {
		expectTypeOf<UniverseVisibility>().toEqualTypeOf<Schema.UniverseVisibility>();
	});

	it("should re-export ResourceEntryByKind with the same identity as core/schema", () => {
		expectTypeOf<ResourceEntryByKind>().toEqualTypeOf<Schema.ResourceEntryByKind>();
	});
});

describe("@bedrock/core/config state and define-config re-exports", () => {
	it("should re-export GistStateConfig with the same identity as core/schema", () => {
		expectTypeOf<GistStateConfig>().toEqualTypeOf<Schema.GistStateConfig>();
	});

	it("should re-export StateConfig with the same identity as core/schema", () => {
		expectTypeOf<StateConfig>().toEqualTypeOf<Schema.StateConfig>();
	});

	it("should re-export ConfigContext with the same identity as shell/define-config", () => {
		expectTypeOf<ConfigContext>().toEqualTypeOf<DefineConfig.ConfigContext>();
	});

	it("should re-export ConfigInput with the same identity as shell/define-config", () => {
		expectTypeOf<ConfigInput>().toEqualTypeOf<DefineConfig.ConfigInput>();
	});

	it("should re-export defineConfig with the same function signature", () => {
		expectTypeOf(ConfigModule.defineConfig).toEqualTypeOf<typeof DefineConfig.defineConfig>();
	});

	it("should re-export SocialLink so universe social-link fields type-check", () => {
		const link: SocialLink = { title: "Discord", uri: "https://discord.gg/example" };
		expectTypeOf<UniverseEntry["discordSocialLink"]>().toExtend<SocialLink | undefined>();
		expectTypeOf(link).toExtend<SocialLink>();
	});
});

describe("@bedrock/core/config runtime surface", () => {
	it("should expose defineConfig as the only runtime export", () => {
		expectTypeOf<keyof typeof ConfigModule>().toEqualTypeOf<"defineConfig">();
	});

	it("should not leak programmatic-api runtime values such as deploy or loadConfig", () => {
		expectTypeOf<keyof typeof ConfigModule>().not.toExtend<
			"applyOps" | "buildDesired" | "deploy" | "flattenConfig" | "loadConfig"
		>();
	});
});
