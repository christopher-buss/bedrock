/**
 * Coordinates the fixture config and the smoke spec both read.
 */

import process from "node:process";

/** Bucket the smoke **State** objects live in. */
export const BUCKET = "bedrock-smoke";

/**
 * Endpoint of the S3-compatible service the bucket lives on: a Cloudflare R2
 * account endpoint, `https://<account-id>.r2.cloudflarestorage.com`. Empty
 * when the runner does not carry it, and the smoke specs skip.
 */
export const ENDPOINT = process.env["BEDROCK_TEST_S3_ENDPOINT"] ?? "";

/** Where the bucket is reached. R2 takes `auto` for its region. */
export const CONNECTION = { endpoint: ENDPOINT, region: "auto" } as const;

/** Folder the smoke **State** objects are written under. */
export const PREFIX = "bedrock-smoke";

/** The one **Environment** this fixture declares. */
export const ENVIRONMENT = "smoke";
