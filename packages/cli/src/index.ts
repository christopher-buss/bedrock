export { diff } from "./core/diff.ts";
export type {
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
export type { DriverRegistry, ResourceDriver } from "./ports/resource-driver.ts";
export {
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	isResourceKey,
	isRobloxAssetId,
	isSha256Hex,
} from "./types/ids.ts";
export type { ResourceKey, RobloxAssetId, Sha256Hex } from "./types/ids.ts";
