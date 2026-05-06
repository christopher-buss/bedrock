/**
 * Curated subset of `@bedrock-rbx/core` for users authoring a `bedrock.config.*`
 * file. Exposes the config-shape interfaces, `defineConfig`, and the
 * `SocialLink` type used by universe fields.
 *
 * Programmatic-api surface (drivers, adapters, ports, `deploy`, `loadConfig`,
 * branded id helpers, error types) lives on the main `@bedrock-rbx/core` barrel.
 */

export type {
	Config,
	ConfigEnvironmentUniverseId,
	ConfigRootUniverseId,
	DeveloperProductEntry,
	EnvironmentEntry,
	GamePassEntry,
	GistStateConfig,
	PlaceEntry,
	ResolvedPlaceEntry,
	ResourceEntryByKind,
	StateConfig,
	UniverseEntry,
	UniverseOverlayWithId,
	UniverseOverlayWithoutId,
} from "./core/schema.ts";
export { defineConfig, type ConfigContext, type ConfigInput } from "./shell/define-config.ts";
export type { SocialLink } from "@bedrock-rbx/ocale/universes";
