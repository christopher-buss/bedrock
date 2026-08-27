export { type S3FailureKind, type S3StateErrorDetail } from "./classify-failure.ts";
export { DEFAULT_LOCK_LEASE_MS } from "./lease.ts";
export type { S3LockFailureKind, S3StateLockErrorDetail } from "./lock-failure.ts";
export type { S3LockHolder } from "./lock-record.ts";
export { s3StateBackend } from "./plugin.ts";
export { default } from "./plugin.ts";
export type { S3StoreDeps } from "./s3-client.ts";
export { createS3StateAdapter } from "./s3-state-adapter.ts";
export {
	createS3StateLockPort,
	DEFAULT_LOCK_TIMEOUT_MS,
	type S3StateLockAdapterDeps,
} from "./s3-state-lock-adapter.ts";
export { s3StateSchema, type S3ChecksumCalculation, type S3StateConfig } from "./state-schema.ts";
