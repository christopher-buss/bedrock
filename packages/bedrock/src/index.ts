export {
	createDeveloperProductDriver,
	type DeveloperProductDriverDeps,
} from "./adapters/developer-product-driver.ts";
export { createGamePassDriver, type GamePassDriverDeps } from "./adapters/game-pass-driver.ts";
export {
	createGistStateAdapter,
	type GistStateAdapterDeps,
} from "./adapters/gist-state-adapter.ts";
export { createPlaceDriver, type PlaceDriverDeps } from "./adapters/place-driver.ts";
export { createUniverseDriver, type UniverseDriverDeps } from "./adapters/universe-driver.ts";
export type { ConfigError, ConfigValidationIssue } from "./core/config-error.ts";
export { derivePriceFields, type PriceFields } from "./core/derive-price-fields.ts";
export { diff } from "./core/diff.ts";
export { DEFAULT_PREFIX_FORMAT, renderDisplayNamePrefix } from "./core/display-name-prefix.ts";
export { validateEnvironmentName } from "./core/environment.ts";
export {
	flattenConfig,
	type DeveloperProductDesiredInput,
	type GamePassDesiredInput,
	type PlaceDesiredInput,
	type ResourceDesiredInput,
	type UniverseDesiredInput,
} from "./core/flatten.ts";
export { getEnvironment, type GetEnvironmentError } from "./core/get-environment.ts";
export { shouldReuploadIcon } from "./core/icons.ts";
export { defaultKindRegistry } from "./core/kinds/index.ts";
export type {
	BuildDesiredError,
	KindIo,
	KindRegistry,
	ResourceKindModule,
} from "./core/kinds/module.ts";
export type {
	MigrateError,
	MigrationReport,
	MigrationSummary,
	MigrationWarning,
	StatesByEnvironment,
} from "./core/migrate/migration-report.ts";
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
	type DeveloperProductDesiredState,
	type DeveloperProductOutputs,
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
	type DeveloperProductEntry,
	type DisplayNamePrefixConfig,
	type EnvironmentEntry,
	type GamePassEntry,
	type GistStateConfig,
	type PlaceEntry,
	type ResolvedConfig,
	type ResolvedPlaceEntry,
	type ResourceEntryByKind,
	type StateConfig,
	type UniverseEntry,
} from "./core/schema.ts";
export {
	selectEnvironment,
	type IncompletePlaceEntryError,
	type SelectEnvironmentError,
	type UnknownEnvironmentError,
} from "./core/select-environment.ts";
export { parseStateFile, serializeStateFile } from "./core/state-file.ts";
export type { BedrockState, StateError } from "./core/state.ts";
export { validatePlan } from "./core/validate-plan.ts";
export type { DriverRegistry, ResourceDriver } from "./ports/resource-driver.ts";
export type { StatePort } from "./ports/state-port.ts";
export { applyOps } from "./shell/apply-ops.ts";
export type { ApplyError } from "./shell/apply-ops.ts";
export { buildDefaultRegistry, type RegistryConfigError } from "./shell/build-default-registry.ts";
export { buildDesired } from "./shell/build-desired.ts";
export {
	buildStatePort,
	type MissingCredentialError,
	type UnsupportedBackendError,
} from "./shell/build-state-port.ts";
export { defineConfig, type ConfigContext, type ConfigInput } from "./shell/define-config.ts";
export { deploy, type DeployError, type DeployOptions } from "./shell/deploy.ts";
export { loadConfig, type LoadConfigOptions } from "./shell/load-config.ts";
export { migrateMantleState, type MigrateMantleStateDeps } from "./shell/migrate-mantle-state.ts";
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
