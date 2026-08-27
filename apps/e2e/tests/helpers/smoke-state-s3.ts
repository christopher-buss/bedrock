import type { StatePort } from "@bedrock-rbx/core";
import { createS3StateAdapter } from "@bedrock-rbx/state-s3";

import process from "node:process";

import { BUCKET, REGION } from "../smoke/fixtures/state-s3/coordinates.ts";

/**
 * Folder the stamped place-deploy **State** objects are written under. Each
 * run adds one, so this folder is pruned.
 */
export const PLACE_PREFIX = "bedrock-smoke-place";

/**
 * Folder the stable resource-deploy **State** objects are written under. Open
 * Cloud caps game-pass and developer-product creation, so those runs share one
 * object apiece and carry the created ids between runs. The folder never
 * grows, and pruning it would throw the ids away.
 */
export const RESOURCE_PREFIX = "bedrock-smoke-resources";

/**
 * Whether the runner carries the credentials the smoke bucket is reached on.
 *
 * Both halves must be present and non-empty. Given one, the AWS default
 * provider carries on to the rest of the chain and queries EC2 instance
 * metadata, which on a runner outside AWS only fails after a wait. An unset
 * GitHub secret reaches the process as an empty string, not as absent.
 */
export const HAS_AWS_CREDENTIALS = [
	process.env["AWS_ACCESS_KEY_ID"],
	process.env["AWS_SECRET_ACCESS_KEY"],
].every((value) => value !== undefined && value !== "");

/**
 * Build a **State** port over the smoke bucket, on the credentials the runner
 * already carries.
 *
 * @param prefix - Folder the **State** objects are written under.
 * @returns The port to hand a **Deploy**.
 */
export function smokeStatePort(prefix: string): StatePort {
	return createS3StateAdapter({ bucket: BUCKET, prefix, region: REGION });
}
