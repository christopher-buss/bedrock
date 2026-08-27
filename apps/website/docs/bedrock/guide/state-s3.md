# S3 state backend

`@bedrock-rbx/state-s3` persists bedrock's state in an S3 bucket, one object per
environment. It is a [plugin](/bedrock/guide/plugins): install it, name it under
`plugins`, and point `state` at a bucket.

```bash
pnpm add @bedrock-rbx/state-s3
```

```ts
import { defineConfig } from "@bedrock-rbx/core/config";

export default defineConfig({
	environments: { production: {} },
	plugins: ["@bedrock-rbx/state-s3"],
	state: { backend: "s3", bucket: "my-bucket", region: "eu-west-2" },
});
```

Production state now lives at `s3://my-bucket/production.json`, and staging at
`s3://my-bucket/staging.json`. Deploying both at once is safe: each environment
addresses its own object, so neither write can land on the other's record.

## Configuration

| Key                   | Required | What it does                                                 |
| --------------------- | -------- | ------------------------------------------------------------ |
| `bucket`              | yes      | Bucket the state objects live in                             |
| `region`              | yes      | Region the bucket lives in                                   |
| `prefix`              | no       | Folder the objects are written under                         |
| `endpoint`            | no       | Endpoint to address instead of AWS                           |
| `forcePathStyle`      | no       | Address the bucket as a path segment rather than a subdomain |
| `checksumCalculation` | no       | `whenSupported` (default) or `whenRequired`                  |

A `prefix` reads as a folder path however you write it, so `bedrock/state`,
`/bedrock/state`, and `bedrock/state/` all put production at
`s3://my-bucket/bedrock/state/production.json`.

## Credentials

Credentials resolve through the standard AWS Node credential chain, so
environment variables, a shared profile, an SSO session, and CI role credentials
all work with nothing bedrock-specific configured. Point the chain at the
account you want the way you would for any other AWS tool.

The credential needs `s3:GetObject` and `s3:PutObject` on the objects and on the
locks beside them. `s3:DeleteObject` is what lets the conditional-write probe
take its scratch object away again; without it the probe still answers, and the
scratch objects are left for the lifecycle rule that expires the locks beside
them:

```json
{
	"Effect": "Allow",
	"Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
	"Resource": "arn:aws:s3:::my-bucket/*"
}
```

Enable versioning on the bucket. Bedrock overwrites the object on every deploy,
and a version history is what lets you recover a state file someone clobbered.

## S3-compatible stores

`endpoint` and `forcePathStyle` reach a store that speaks the S3 protocol
somewhere other than AWS, and `checksumCalculation: "whenRequired"` drops the
checksum headers some of them reject:

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

Support for those stores is best effort. Only AWS is tested, so treat a
compatible store as something to verify against your own bucket before you
depend on it.

## What failures look like

A missing object is a first deploy, not a failure: bedrock reads no state and
creates everything the config declares. A corrupt object is a failure and stays
one, because a deploy that read empty state would re-create every resource it
already owns.

| Condition                                | Reported as          |
| ---------------------------------------- | -------------------- |
| Bucket does not resolve                  | `stateNotFound`      |
| Credential reached the store, refused    | `stateAccessDenied`  |
| Object exists but cannot be parsed       | `stateError`         |
| No credential resolved at all            | `pluginStateBackend` |
| A refusal the backend does not recognize | `pluginStateBackend` |

The `pluginStateBackend` arm carries a payload naming what the store said: which
of those two conditions it was, the S3 error code, and the HTTP status.

## Locking

A deploy takes a hold on its environment before it applies anything and gives it
up once state has been written, so two CI jobs pointed at one environment are
serialized instead of both creating resources on Roblox. The hold is a
`locks/<environment>.json` object beside the state objects, created
conditionally so exactly one run can hold it. Because locks sit under their own
prefix segment, a bucket lifecycle rule can expire abandoned ones without
touching state.

A run that finds the environment held waits, retrying with exponential backoff
for five minutes by default. `lockTimeoutMs` changes that bound, and `0` refuses
immediately. Giving up names who holds the environment and since when.

### The store is proved first

Exclusion rests on the store refusing a create of an object it already holds, so
bedrock proves it rather than assuming it. Before the first hold of a deploy, it
writes a scratch object under `locks/.probe-<id>.json`, writes it again
requiring the object to be absent, and reads the refusal as the proof. The
scratch object is taken away once the store has answered.

A store that takes the second write evaluated no condition and would hand every
run that asks the same hold. It gets no locking, and the deploy stops saying so
rather than running unprotected: exclusion that does not exclude is worse than
none.
