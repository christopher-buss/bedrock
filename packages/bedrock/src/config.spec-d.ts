import { describe, expectTypeOf, it } from "vitest";

import { defineConfig } from "./config.ts";
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
} from "./config.ts";
import type {
	Config as ConfigSource,
	DeveloperProductEntry as DeveloperProductEntrySource,
	EnvironmentEntry as EnvironmentEntrySource,
	GamePassEntry as GamePassEntrySource,
	GistStateConfig as GistStateConfigSource,
	PlaceEntry as PlaceEntrySource,
	ResolvedPlaceEntry as ResolvedPlaceEntrySource,
	ResourceEntryByKind as ResourceEntryByKindSource,
	StateConfig as StateConfigSource,
	UniverseEntry as UniverseEntrySource,
} from "./core/schema.ts";
import type {
	ConfigContext as ConfigContextSource,
	ConfigInput as ConfigInputSource,
	defineConfig as defineConfigSource,
} from "./shell/define-config.ts";

describe("@bedrock-rbx/core/config resource-entry re-exports", () => {
	it("should re-export Config with the same identity as core/schema", () => {
		expectTypeOf<Config>().toEqualTypeOf<ConfigSource>();
	});

	it("should re-export EnvironmentEntry with the same identity as core/schema", () => {
		expectTypeOf<EnvironmentEntry>().toEqualTypeOf<EnvironmentEntrySource>();
	});

	it("should re-export GamePassEntry with the same identity as core/schema", () => {
		expectTypeOf<GamePassEntry>().toEqualTypeOf<GamePassEntrySource>();
	});

	it("should re-export DeveloperProductEntry with the same identity as core/schema", () => {
		expectTypeOf<DeveloperProductEntry>().toEqualTypeOf<DeveloperProductEntrySource>();
	});

	it("should re-export PlaceEntry with the same identity as core/schema", () => {
		expectTypeOf<PlaceEntry>().toEqualTypeOf<PlaceEntrySource>();
	});

	it("should re-export ResolvedPlaceEntry with the same identity as core/schema", () => {
		expectTypeOf<ResolvedPlaceEntry>().toEqualTypeOf<ResolvedPlaceEntrySource>();
	});

	it("should re-export UniverseEntry with the same identity as core/schema", () => {
		expectTypeOf<UniverseEntry>().toEqualTypeOf<UniverseEntrySource>();
	});

	it("should re-export ResourceEntryByKind with the same identity as core/schema", () => {
		expectTypeOf<ResourceEntryByKind>().toEqualTypeOf<ResourceEntryByKindSource>();
	});
});

describe("@bedrock-rbx/core/config state and define-config re-exports", () => {
	it("should re-export GistStateConfig with the same identity as core/schema", () => {
		expectTypeOf<GistStateConfig>().toEqualTypeOf<GistStateConfigSource>();
	});

	it("should re-export StateConfig with the same identity as core/schema", () => {
		expectTypeOf<StateConfig>().toEqualTypeOf<StateConfigSource>();
	});

	it("should re-export ConfigContext with the same identity as shell/define-config", () => {
		expectTypeOf<ConfigContext>().toEqualTypeOf<ConfigContextSource>();
	});

	it("should re-export ConfigInput with the same identity as shell/define-config", () => {
		expectTypeOf<ConfigInput>().toEqualTypeOf<ConfigInputSource>();
	});

	it("should re-export defineConfig with the same function signature", () => {
		expectTypeOf(defineConfig).toEqualTypeOf<typeof defineConfigSource>();
	});

	it("should re-export SocialLink so universe social-link fields type-check", () => {
		const link: SocialLink = { title: "Discord", uri: "https://discord.gg/example" };
		expectTypeOf<UniverseEntry["discordSocialLink"]>().toExtend<SocialLink | undefined>();
		expectTypeOf(link).toExtend<SocialLink>();
	});
});

describe("@bedrock-rbx/core/config runtime surface", () => {
	it("should not leak programmatic-api symbols such as deploy or loadConfig", () => {
		type ProgrammaticApi =
			| "applyOps"
			| "buildDesired"
			| "deploy"
			| "flattenConfig"
			| "loadConfig"
			| "migrateMantleState";
		type ConfigKeys = keyof typeof import("./config.ts");
		expectTypeOf<Extract<ConfigKeys, ProgrammaticApi>>().toEqualTypeOf<never>();
	});
});
