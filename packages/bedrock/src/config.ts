/**
 * Curated subset of `@bedrock/core` for users authoring a `bedrock.config.*`
 * file. Exposes the config-shape interfaces, `defineConfig`, and the
 * `SocialLink` type used by universe fields.
 *
 * Programmatic-api surface (drivers, adapters, ports, `deploy`, `loadConfig`,
 * branded id helpers, error types) lives on the main `@bedrock/core` barrel.
 */

export type {
	Config,
	DeveloperProductEntry,
	EnvironmentEntry,
	GamePassEntry,
	GistStateConfig,
	PlaceEntry,
	ResolvedPlaceEntry,
	ResourceEntryByKind,
	StateConfig,
	UniverseEntry,
} from "./core/schema.ts";
export { defineConfig, type ConfigContext, type ConfigInput } from "./shell/define-config.ts";
export type { SocialLink } from "@bedrock/ocale/universes";
