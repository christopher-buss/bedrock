import { S3Client } from "@aws-sdk/client-s3";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import type { StateBackendFetch } from "@bedrock-rbx/core";
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from "@smithy/types";

import { createFetchRequestHandler } from "./fetch-request-handler.ts";
import type { S3ChecksumCalculation } from "./state-schema.ts";

// How this **Backend**'s checksum setting reads in the client's own terms.
const CHECKSUM_CALCULATION = {
	whenRequired: "WHEN_REQUIRED",
	whenSupported: "WHEN_SUPPORTED",
} as const satisfies Record<S3ChecksumCalculation, string>;

/**
 * Everything a port this **Backend** builds needs to reach one bucket.
 *
 * @since unreleased
 */
export interface S3StateAdapterDeps {
	/** Bucket the **State** objects live in. */
	readonly bucket: string;
	/**
	 * How request checksums are calculated; defaults to `whenSupported`,
	 * which is what AWS expects.
	 */
	readonly checksumCalculation?: S3ChecksumCalculation | undefined;
	/**
	 * Credentials to sign with. Omit to resolve them through the standard
	 * AWS Node credential chain, so environment variables, a shared
	 * profile, an SSO session, and CI role credentials all work without
	 * anything bedrock-specific.
	 */
	readonly credentials?: AwsCredentialIdentity | AwsCredentialIdentityProvider | undefined;
	/** Endpoint to address instead of AWS. */
	readonly endpoint?: string | undefined;
	/** Transport the client's requests are sent through. */
	readonly fetch?: StateBackendFetch | undefined;
	/** Whether the bucket is addressed as a path segment. */
	readonly forcePathStyle?: boolean | undefined;
	/** Folder the **State** objects are written under. */
	readonly prefix?: string | undefined;
	/** Region the bucket lives in. */
	readonly region: string;
}

/**
 * Build the S3 client both of this **Backend**'s ports send through, with
 * the transport seam routed through the `fetch` core injected so the real
 * client's signing, marshalling, and error deserialization stay in play.
 *
 * @param deps - Bucket coordinates plus the credential and transport seams.
 * @returns The configured client.
 */
export function createConfiguredS3Client(deps: S3StateAdapterDeps): S3Client {
	return new S3Client({
		...(deps.endpoint === undefined ? {} : { endpoint: deps.endpoint }),
		credentials: deps.credentials ?? defaultProvider(),
		forcePathStyle: deps.forcePathStyle ?? false,
		region: deps.region,
		requestChecksumCalculation:
			CHECKSUM_CALCULATION[deps.checksumCalculation ?? "whenSupported"],
		requestHandler: createFetchRequestHandler(deps.fetch ?? fetch.bind(globalThis)),
	});
}
