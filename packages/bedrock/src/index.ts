export { createGamePassDriver, type GamePassDriverDeps } from "./adapters/game-pass-driver.ts";
export {
	createGistStateAdapter,
	type GistStateAdapterDeps,
} from "./adapters/gist-state-adapter.ts";
export { createPlaceDriver, type PlaceDriverDeps } from "./adapters/place-driver.ts";
export { createUniverseDriver, type UniverseDriverDeps } from "./adapters/universe-driver.ts";
export type { ConfigError, ConfigValidationIssue } from "./core/config-error.ts";
export { diff } from "./core/diff.ts";
export { validateEnvironmentName } from "./core/environment.ts";
export {
	flattenConfig,
	type GamePassDesiredInput,
	type PlaceDesiredInput,
	type ResourceDesiredInput,
	type UniverseDesiredInput,
} from "./core/flatten.ts";
export { defaultKindRegistry } from "./core/kinds/index.ts";
export type {
	BuildDesiredError,
	KindIo,
	KindRegistry,
	ResourceKindModule,
} from "./core/kinds/module.ts";
export type {
	BaseOperation,
	CreateOperation,
	NoopOperation,
	Operation,
	UpdateOperation,
} from "./core/operations.ts";
export { resolveStateConfig, type StateNotConfiguredError } from "./core/resolve-state-config.ts";
export {
	SOCIAL_LINK_FIELDS,
	UNIVERSE_SINGLETON_KEY,
	type GamePassDesiredState,
	type GamePassOutputs,
	type PlaceDesiredState,
	type PlaceOutputs,
	type ResourceCurrentState,
	type ResourceDesiredState,
	type ResourceKind,
	type ResourceOutputs,
	type ResourceOutputsByKind,
	type SocialLinkField,
	type UniverseDesiredState,
	type UniverseOutputs,
} from "./core/resources.ts";
export {
	isGistStateConfig,
	validateConfig,
	type Config,
	type EnvironmentEntry,
	type GamePassEntry,
	type GistStateConfig,
	type PlaceEntry,
	type ResourceEntryByKind,
	type StateConfig,
	type UniverseEntry,
	type UniverseVisibility,
} from "./core/schema.ts";
export { parseStateFile, serializeStateFile } from "./core/state-file.ts";
export type { BedrockState, StateError } from "./core/state.ts";
export type { DriverRegistry, ResourceDriver } from "./ports/resource-driver.ts";
export type { StatePort } from "./ports/state-port.ts";
export { applyOps } from "./shell/apply-ops.ts";
export type { ApplyError } from "./shell/apply-ops.ts";
export { buildDesired } from "./shell/build-desired.ts";
export {
	buildStatePort,
	type BuildStatePortDeps,
	type MissingCredentialError,
	type UnsupportedBackendError,
} from "./shell/build-state-port.ts";
export { defineConfig, type ConfigContext, type ConfigInput } from "./shell/define-config.ts";
export { deploy, type DeployError, type DeployOptions } from "./shell/deploy.ts";
export { loadConfig, type LoadConfigOptions } from "./shell/load-config.ts";
export {
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	isResourceKey,
	isRobloxAssetId,
	isSha256Hex,
} from "./types/ids.ts";
export type { ResourceKey, RobloxAssetId, Sha256Hex } from "./types/ids.ts";
export { OpenCloudError, type Result } from "@bedrock/ocale";
export type { SocialLink } from "@bedrock/ocale/universes";
