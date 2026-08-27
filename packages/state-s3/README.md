# @bedrock-rbx/state-s3

S3 state backend for [bedrock](https://github.com/christopher-buss/bedrock).

[![npm version](https://img.shields.io/npm/v/@bedrock-rbx/state-s3.svg)](https://npmx.dev/package/@bedrock-rbx/state-s3)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/christopher-buss/bedrock/blob/main/LICENSE)
[![CI](https://github.com/christopher-buss/bedrock/actions/workflows/ci.yaml/badge.svg)](https://github.com/christopher-buss/bedrock/actions/workflows/ci.yaml)

> **Status: 0.1, pre-1.0.** The public API is stabilizing; breaking changes may
> land in minor releases until 1.0.

## What it does

Persists bedrock's deployment state in an S3 bucket, one object per environment,
so deploying two environments at once never puts them in contention. It also
locks: two CI jobs deploying one environment are serialized, and the second
waits for the first rather than both creating resources on Roblox. It is an
ordinary bedrock plugin: it reaches core only through the published plugin
contract, so nothing it does is closed to a third-party backend.

## Install

```bash
pnpm add @bedrock-rbx/state-s3
# or: npm install @bedrock-rbx/state-s3
```

## Use

Name the package under `plugins` and point `state` at a bucket:

```ts
import { defineConfig } from "@bedrock-rbx/core/config";

export default defineConfig({
	environments: { production: {} },
	plugins: ["@bedrock-rbx/state-s3"],
	state: { backend: "s3", bucket: "my-bucket", region: "eu-west-2" },
});
```

Production state now lives at `s3://my-bucket/production.json`.

## Configuration

| Key                   | Required | What it does                                                 |
| --------------------- | -------- | ------------------------------------------------------------ |
| `bucket`              | yes      | Bucket the state objects live in                             |
| `region`              | yes      | Region the bucket lives in                                   |
| `prefix`              | no       | Folder the objects are written under                         |
| `endpoint`            | no       | Endpoint to address instead of AWS                           |
| `forcePathStyle`      | no       | Address the bucket as a path segment rather than a subdomain |
| `checksumCalculation` | no       | `whenSupported` (default) or `whenRequired`                  |
| `lockTimeoutMs`       | no       | How long to wait for a held environment; 5 minutes by default |

## Credentials

Credentials resolve through the standard AWS Node credential chain, so
environment variables, a shared profile, an SSO session, and CI role credentials
all work with no bedrock-specific configuration.

Grant `s3:GetObject` and `s3:PutObject` on the objects and on the locks beside
them, under the prefix if you configured one:

```json
{
	"Effect": "Allow",
	"Action": ["s3:GetObject", "s3:PutObject"],
	"Resource": "arn:aws:s3:::my-bucket/*"
}
```

## S3-compatible stores

`endpoint` and `forcePathStyle` make non-AWS stores reachable, and
`checksumCalculation: "whenRequired"` drops the checksum headers that some of
them reject:

```ts
export default defineConfig({
	environments: { production: {} },
	plugins: ["@bedrock-rbx/state-s3"],
	state: {
		backend: "s3",
		bucket: "my-bucket",
		checksumCalculation: "whenRequired",
		endpoint: "http://localhost:9000",
		forcePathStyle: true,
		region: "us-east-1",
	},
});
```

Support for those stores is best effort: only AWS is tested.

## Locking

A deploy takes a hold on its environment before it applies anything, and gives
it up once state has been written. The hold is a `locks/<environment>.json`
object beside the state objects, created conditionally so exactly one run can
hold it. Because locks sit under their own prefix segment, a bucket lifecycle
rule can expire abandoned ones without touching state.

A run that finds the environment held waits, retrying with exponential backoff
for five minutes by default; `lockTimeoutMs` changes that bound and `0` refuses
immediately. The wait is reported through the progress port while it happens,
and giving up names who holds the environment and since when.

A hold is given up by writing a tombstone over its own record, never by deleting
the lock object: conditional delete is not portable across S3-compatible stores,
and one of them ignores the condition and deletes anyway.

The run is recorded as `BEDROCK_LOCK_OWNER` when that is set, as the URL of the
GitHub Actions run when `GITHUB_RUN_ID` is, and as the local user otherwise.

## Failures

A missing object is a first deploy, not a failure: reading it yields no state. A
corrupt object never collapses to empty state, because a deploy that read empty
state would re-create every resource it already owns.

Everything else arrives as a typed `StateError`. A bucket that does not resolve
is `stateNotFound` and a credential the store refused is `stateAccessDenied`.
Anything only this backend can describe - no credential resolving at all, or a
refusal it does not recognize - arrives as `pluginStateBackend` carrying an
`S3StateErrorDetail` payload.

A hold that could not be taken arrives as a `StateLockError` carrying an
`S3StateLockErrorDetail` payload, which names the lock object, what went wrong,
and on a timeout who held the environment and how long the wait ran.

## License

MIT
