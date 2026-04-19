/** @public */
export { diff } from "./core/diff.ts";
/** @public */
export type {
	CreateOperation,
	NoopOperation,
	Operation,
	UpdateOperation,
} from "./core/operations.ts";
/** @public */
export type {
	GamePassDesiredState,
	GamePassOutputs,
	ResourceCurrentState,
	ResourceDesiredState,
	ResourceKind,
	ResourceOutputs,
	ResourceOutputsByKind,
} from "./core/resources.ts";
export {
	asResourceKey,
	asRobloxAssetId,
	asSha256Hex,
	isResourceKey,
	isRobloxAssetId,
	isSha256Hex,
} from "./types/ids.ts";
export type { ResourceKey, RobloxAssetId, Sha256Hex } from "./types/ids.ts";
