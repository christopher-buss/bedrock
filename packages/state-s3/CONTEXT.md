# S3 State Backend Package

`@bedrock-rbx/state-s3` persists bedrock **State** in an S3 bucket. It is a
plugin, not a part of core: everything it reaches for is published on the plugin
contract, so a third-party backend can be built the same way.

This context borrows core's vocabulary (**State**, **Environment**, **Deploy**,
**Backend**, **State port**, **Version**) unchanged. The terms below are the
ones this package adds.

## Language

**Object**: One S3 object holding one **Environment**'s **State**, keyed
`<prefix>/<environment>.json`. One object per **Environment** is the property
that keeps two environments deploying at once out of contention: they address
different keys, so neither write can land on the other's record. _Avoid_: file,
blob, state file

**Hold**: One run's claim on an **Environment**, taken before a **Deploy**
applies anything and given up once **State** has been written. It is a **Lock
object** created conditionally, so exactly one run can hold an **Environment**
at a time. _Avoid_: lock (for the claim itself), mutex, semaphore

**Lock object**: The object one **Hold** is recorded in, keyed
`<prefix>/locks/<environment>.json`. It sits under its own segment rather than
beside the **State** **Object**s because a bucket lifecycle rule filters by
prefix and cannot filter by suffix, so keeping them apart is what lets an
operator expire abandoned **Hold**s without reaching **State**. A **Hold** is
given up by writing a **Tombstone** over the record, never by deleting the
object. _Avoid_: lock file, lease file

**Blocker**: The **Hold** one acquisition read in its way, carried only so a
wait that runs out can name it. It is replaced by every round that reads the
**Lock object**, so a run that has since released is never reported as still
holding, and it is absent whenever no round could name one. _Avoid_: holder (for
the reading rather than the run), owner

**Tombstone**: The record a release writes back, marked with the instant the
**Hold** was given up. It is written conditionally on the exact bytes the
**Hold** was taken as, so a run that took the **Environment** over in the
meantime keeps its own **Hold**. Conditional delete would be the obvious
alternative and is not portable: recent on S3, undocumented on R2, and silently
ignored by at least one S3-compatible implementation which deletes anyway and
reports success. _Avoid_: delete marker, unlock record

**Probe**: The proof a **Store** refuses a create of an **Object** it already
holds, taken once per **Deploy** before the first **Hold** is. It writes a
scratch **Object** under the **Lock object**'s own segment, writes it again
fenced on the **Object** being absent, and reads the refusal as the proof, then
takes the scratch **Object** away. A **Store** that takes the second write
evaluated nothing, so it would grant every run the same **Hold**; it gets no
locking, and the **Deploy** stops rather than running unprotected. _Avoid_:
capability check, preflight, health check

**Prefix**: The folder the **Object**s are written under, read as a path however
it was written (`bedrock/state`, `/bedrock/state/`, and `bedrock/state/` are one
prefix). Absent, the **Object**s sit at the bucket root. _Avoid_: path, folder,
namespace

**Store**: The bucket the **Object**s live in, addressed either at AWS or at an
`endpoint` an S3-compatible implementation serves. A **Store** that does not
resolve is `stateNotFound`; a missing **Object** inside one is an
**Environment** that has never been deployed. _Avoid_: bucket (in prose about
failures), backend

**Entity tag**: What the **Store** answers a read of an **Object** with, carried
back to core as the **Version** of that record and returned as the write's
`If-Match`. An **Object** that is absent is fenced with a bare
`If-None-Match: *` instead, never quoted: at least one S3-compatible
implementation compares the raw header before stripping quotes, so a quoted
wildcard degrades into an unconditional overwrite. _Avoid_: etag (lowercase, in
prose), hash, checksum

**Refusal**: What the S3 client threw, read into the terms this package owns
(`missingObject`, `missingStore`, `accessDenied`, `conflict`,
`missingCredentials`, `requestFailed`) before it is reported as a `StateError`.
The reading is by error code first and HTTP status second, because
`NoSuchBucket` also answers `404` and reading it as a missing **Object** would
report a mistyped bucket as a first **Deploy**. _Avoid_: error code, exception

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

The **Lease** is not here yet. A **Hold** carries who took it, what for, and
when, but nothing expires it, so a run killed mid-deploy leaves a **Hold** that
stands until someone takes it over.
