import type { StateBackendPromptField } from "@bedrock-rbx/core";

/**
 * Fields `bedrock migrate` asks for when a user writes their migrated
 * **State** into a bucket. They are the `state` keys a **Deploy** needs,
 * asked in the order a user reads them off their bucket.
 */
export const s3MigratePrompts: ReadonlyArray<StateBackendPromptField> = [
	{
		key: "bucket",
		label: "Bucket to store state in?",
		placeholder: "my-bucket",
		validationMessage: "A bucket is required",
	},
	{
		key: "region",
		label: "Region the bucket lives in?",
		placeholder: "eu-west-2",
		validationMessage: "A region is required",
	},
	{
		key: "endpoint",
		label: "Endpoint to address instead of AWS? (leave empty for AWS)",
		placeholder: "https://<account>.r2.cloudflarestorage.com",
	},
];
