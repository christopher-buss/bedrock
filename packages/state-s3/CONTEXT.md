# S3 State Backend Package

`@bedrock-rbx/state-s3` persists bedrock **State** in an S3 bucket. It is a
plugin, not a part of core: everything it reaches for is published on the plugin
contract, so a third-party backend can be built the same way.

This context borrows core's vocabulary (**State**, **Environment**, **Deploy**,
**Backend**, **State port**) unchanged. The terms below are the ones this
package adds.

## Language

**Object**: One S3 object holding one **Environment**'s **State**, keyed
`<prefix>/<environment>.json`. One object per **Environment** is the property
that keeps two environments deploying at once out of contention: they address
different keys, so neither write can land on the other's record. _Avoid_: file,
blob, state file

**Prefix**: The folder the **Object**s are written under, read as a path however
it was written (`bedrock/state`, `/bedrock/state/`, and `bedrock/state/` are one
prefix). Absent, the **Object**s sit at the bucket root. _Avoid_: path, folder,
namespace

**Store**: The bucket the **Object**s live in, addressed either at AWS or at an
`endpoint` an S3-compatible implementation serves. A **Store** that does not
resolve is `stateNotFound`; a missing **Object** inside one is an
**Environment** that has never been deployed. _Avoid_: bucket (in prose about
failures), backend

**Refusal**: What the S3 client threw, read into the terms this package owns
(`missingObject`, `missingStore`, `accessDenied`, `missingCredentials`,
`requestFailed`) before it is reported as a `StateError`. The reading is by
error code first and HTTP status second, because `NoSuchBucket` also answers
`404` and reading it as a missing **Object** would report a mistyped bucket as a
first **Deploy**. _Avoid_: error code, exception

**Transport**: The `fetch` the client's requests are routed through, injected by
core and defaulted to the runtime's own. Swapping it leaves the client real, so
signing, marshalling, and error deserialization are exercised by this package's
tests rather than stubbed at `send`. _Avoid_: http client, mock, request handler

## Boundaries

- **`@bedrock-rbx/state-s3` → `@bedrock-rbx/core`**: a peer dependency, reached
  only through its published barrel. The **State** file format is core's:
  `serializeStateFile` and `parseStateFile` own it, and this package moves the
  bytes they produce. Environment names are validated with core's own
  `validateEnvironmentName`, so a name that could escape the **Object** layout
  is refused on the same terms every **Backend** refuses it.
- **`@bedrock-rbx/state-s3` → the AWS SDK**: the client is the real one.
  Credentials resolve through the standard AWS Node credential chain, except
  where the environment core injects already holds a key pair, which the
  **Backend** reads rather than reaching for `process.env`.

## Deliberately absent

Locking and conditional writes (ADR-031) are not here yet: `StatePort` has no
version token to make a write conditional on, so this **Backend** writes
unconditionally, exactly as the Gist **Backend** does.
