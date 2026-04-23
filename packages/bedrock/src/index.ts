export { createGamePassDriver, type GamePassDriverDeps } from "./adapters/game-pass-driver.ts";
export { createPlaceDriver, type PlaceDriverDeps } from "./adapters/place-driver.ts";
export type { ConfigError, ConfigValidationIssue } from "./core/config-error.ts";
export { diff } from "./core/diff.ts";
export {
	flattenConfig,
	type GamePassDesiredInput,
	type PlaceDesiredInput,
	type ResourceDesiredInput,
} from "./core/flatten.ts";
export type {
	BaseOperation,
	CreateOperation,
	NoopOperation,
	Operation,
	UpdateOperation,
} from "./core/operations.ts";
export {
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
	type UniverseDesiredState,
	type UniverseOutputs,
} from "./core/resources.ts";
export { validateConfig, type Config, type GamePassEntry, type PlaceEntry } from "./core/schema.ts";
export type { BedrockState, StateError } from "./core/state.ts";
export type { DriverRegistry, ResourceDriver } from "./ports/resource-driver.ts";
export type { StatePort } from "./ports/state-port.ts";
export { applyOps } from "./shell/apply-ops.ts";
export type { ApplyError } from "./shell/apply-ops.ts";
export { buildDesired } from "./shell/build-desired.ts";
export type { BuildDesiredError } from "./shell/build-desired.ts";
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
