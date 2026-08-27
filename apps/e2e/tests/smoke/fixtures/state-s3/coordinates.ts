/**
 * Coordinates the fixture config and the smoke spec both read.
 */

/** Bucket the smoke **State** objects live in. */
export const BUCKET = "christopher-buss-mantle-states";

/** Region the bucket lives in. */
export const REGION = "eu-central-1";

/** Folder the smoke **State** objects are written under. */
export const PREFIX = "bedrock-smoke";

/** The one **Environment** this fixture declares. */
export const ENVIRONMENT = "smoke";
