export { type S3FailureKind } from "./classify-failure.ts";
export { s3StateBackend } from "./plugin.ts";
export { default } from "./plugin.ts";
export {
	createS3StateAdapter,
	type S3StateAdapterDeps,
	type S3StateErrorDetail,
} from "./s3-state-adapter.ts";
export { s3StateSchema, type S3ChecksumCalculation, type S3StateConfig } from "./state-schema.ts";
