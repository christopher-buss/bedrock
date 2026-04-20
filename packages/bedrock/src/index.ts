export { createGamePassDriver, type GamePassDriverDeps } from "./adapters/game-pass-driver.ts";
export { diff } from "./core/diff.ts";
export type {
	BaseOperation,
	CreateOperation,
	NoopOperation,
	Operation,
	UpdateOperation,
} from "./core/operations.ts";
export type {
	GamePassDesiredState,
	GamePassOutputs,
	ResourceCurrentState,
	ResourceDesiredState,
	ResourceKind,
	ResourceOutputs,
	ResourceOutputsByKind,
} from "./core/resources.ts";
export type { BedrockState, StateError } from "./core/state.ts";
export type { DriverRegistry, ResourceDriver } from "./ports/resource-driver.ts";
export type { StatePort } from "./ports/state-port.ts";
export { applyOps } from "./shell/apply-ops.ts";
export type { ApplyError } from "./shell/apply-ops.ts";
export { buildDesired } from "./shell/build-desired.ts";
export type {
	BuildDesiredError,
	GamePassConfigInput,
	Slice1ConfigInput,
} from "./shell/build-desired.ts";
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
