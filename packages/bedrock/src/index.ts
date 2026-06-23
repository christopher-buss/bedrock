export {
	createClackProgressAdapter,
	type ClackProgressAdapterDeps,
} from "./adapters/clack-progress-adapter.ts";
export {
	createDeveloperProductDriver,
	type DeveloperProductDriverDeps,
} from "./adapters/developer-product-driver.ts";
export { createFsCodegenWriter, type FsCodegenWriterDeps } from "./adapters/fs-codegen-writer.ts";
export { createGamePassDriver, type GamePassDriverDeps } from "./adapters/game-pass-driver.ts";
export {
	createGistStateAdapter,
	type GistStateAdapterDeps,
} from "./adapters/gist-state-adapter.ts";
export { createNoOpProgressAdapter } from "./adapters/no-op-progress-adapter.ts";
export { createPlaceDriver, type PlaceDriverDeps } from "./adapters/place-driver.ts";
export { createUniverseDriver, type UniverseDriverDeps } from "./adapters/universe-driver.ts";
export { createClackPort } from "./cli/clack-port.ts";
export { createDefaultSpawner } from "./cli/default-spawner.ts";
export {
	dispatchOverride,
	type OverrideInvocation,
	type SpawnOverrideError,
} from "./cli/dispatch-override.ts";
export type { ClackPort } from "./cli/render.ts";
export type {
	Spawner,
	SpawnInvocation,
	SpawnLaunchCause,
	SpawnLaunchError,
} from "./cli/spawner.ts";
export {
	codegenView,
	isRedacted,
	pushedValue,
	realValue,
	type CodegenView,
	type Field,
} from "./core/codegen-view.ts";
export type { CodegenFile, EmitInput, Emitter } from "./core/codegen.ts";
export type { ConfigError, ConfigValidationIssue } from "./core/config-error.ts";
export {
	createDefaultEmitter,
	DEFAULT_CODEGEN_OUTPUT_DIR,
	type DefaultEmitterOptions,
} from "./core/default-emitter.ts";
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
export type { RebuildHook, RebuiltPlace } from "./core/rebuild.ts";
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
	type ResourceRealDisplay,
	type SocialLinkField,
	type UniverseDesiredState,
	type UniverseOutputs,
} from "./core/resources.ts";
export {
	isGistStateConfig,
	validateConfig,
	type CodegenConfig,
	type Config,
	type ConfigEnvironmentUniverseId,
	type ConfigRootUniverseId,
	type DeveloperProductEntry,
	type DisplayNamePrefixConfig,
	type EnvironmentEntry,
	type GamePassEntry,
	type GistStateConfig,
	type PlaceEntry,
	type RedactedDeveloperProductOverride,
	type RedactedEnvironmentOverride,
	type RedactedGamePassOverride,
	type RedactedPlaceOverride,
	type ResolvedConfig,
	type ResolvedPlaceEntry,
	type ResolvedUniverseEntry,
	type ResourceEntryByKind,
	type StateConfig,
	type UniverseEntry,
	type UniverseOverlayWithId,
	type UniverseOverlayWithoutId,
} from "./core/schema.ts";
export {
	selectEnvironment,
	type IncompletePlaceEntryError,
	type IncompleteUniverseEntryError,
	type SelectEnvironmentError,
	type UnknownEnvironmentError,
} from "./core/select-environment.ts";
export { parseStateFile, serializeStateFile } from "./core/state-file.ts";
export type { BedrockState, StateError } from "./core/state.ts";
export type { CodegenWriteError, CodegenWriterPort } from "./ports/codegen-writer.ts";
export type {
	ApplySummaryEvent,
	DeployFailureEvent,
	DeploySuccessEvent,
	ProgressEvent,
	ProgressPort,
	ResourceOpFailedEvent,
	ResourceOpNoopEvent,
	ResourceOpStartedEvent,
	ResourceOpSucceededCreateEvent,
	ResourceOpSucceededEvent,
	ResourceOpSucceededUpdateEvent,
	StateWrittenEvent,
} from "./ports/progress-port.ts";
export type {
	DriverRegistry,
	ResourceApplyContext,
	ResourceDriver,
} from "./ports/resource-driver.ts";
export type { StatePort } from "./ports/state-port.ts";
export { applyOps } from "./shell/apply-ops.ts";
export type { AggregateApplyError, ApplyError, ApplyOpsReporting } from "./shell/apply-ops.ts";
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
export type { CodegenError } from "./shell/run-codegen.ts";
export {
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	isResourceKey,
	isRobloxAssetId,
	isSha256Hex,
} from "./types/ids.ts";
export type { ResourceKey, RobloxAssetId, Sha256Hex } from "./types/ids.ts";
export { OpenCloudError, type Result } from "@bedrock-rbx/ocale";
export type { SocialLink } from "@bedrock-rbx/ocale/universes";
