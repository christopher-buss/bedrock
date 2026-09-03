# @bedrock-rbx/state-s3

## 0.3.0

### Patch Changes

- Updated dependencies:
  - @bedrock-rbx/core@0.3.0

## 0.2.3

### Patch Changes

- Accept a plugin object in the config's `plugins` list, alongside the module specifiers it already took. A config authored in TypeScript can import the plugin and list it directly, which types the `state` block from what that plugin declares: `import { bedrockS3Plugin } from "@bedrock-rbx/state-s3"` then `plugins: [bedrockS3Plugin]` completes `bucket`, `region`, and every other key the backend declares, and rejects a misspelled key, a missing required key, or a `backend` that no listed plugin claims at compile time rather than at deploy time. The union closes around the built-in backend and the ones the listed plugins declare; listing a plugin by specifier leaves the block open as before, which is what the YAML, JSON, and Luau formats get. `BedrockPlugin` now requires a `name`, which is how a diagnostic refers to a plugin the config listed no specifier for, and `loadConfig` resolves every entry to the name of the plugin that loaded.

- Read `BEDROCK_S3_ACCESS_KEY_ID`, `BEDROCK_S3_SECRET_ACCESS_KEY`, and `BEDROCK_S3_SESSION_TOKEN` ahead of their `AWS_` counterparts, so a machine whose AWS variables already point at another account can send bedrock somewhere else. Each set is read as a whole credential: a half-written prefixed pair leaves the `AWS_` pair signing on its own, and a prefixed pair takes its session token from `BEDROCK_S3_SESSION_TOKEN` alone, so no signing mixes one account's key with another's secret.

- Updated dependencies:
  - @bedrock-rbx/core@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies:
  - @bedrock-rbx/core@0.2.2

## 0.2.1

### Patch Changes

- Republish `@bedrock-rbx/state-s3` through npm's trusted publishing flow, so the tarball carries a provenance attestation tying it to the workflow run and the commit that built it. The 0.2.0 tarball was published by hand and carries none: a trusted publisher cannot be configured on npmjs.com until the package name exists, so the first release had nothing to exchange its OIDC token against. The plugin itself is unchanged.

- Updated dependencies:
  - @bedrock-rbx/core@0.2.1

## 0.2.0

### Minor Changes

- Make the write conditional on the object that was read. A read carries the object's entity tag back as its `StateVersion`, and the write that follows sends it as `If-Match`; a read that found no object fences the write with a bare `If-None-Match: *`, never quoted, because at least one S3-compatible implementation compares the raw header before stripping quotes and would degrade the create-if-absent into an unconditional overwrite. A precondition failure, a concurrent-write conflict, and a record deleted between the read and the write are each reported as `stateConflict`. A write given no version overwrites as before.

### Patch Changes

- Add `@bedrock-rbx/state-s3`, a plugin that persists **State** in an S3 bucket. List it under `plugins` and point `state` at a bucket and region: `state: { backend: "s3", bucket: "my-bucket", region: "eu-west-2" }`, with optional `prefix`, `endpoint`, `forcePathStyle`, and `checksumCalculation` keys. Credentials resolve through the standard AWS Node credential chain, so environment variables, a shared profile, an SSO session, and CI role credentials all work with nothing bedrock-specific configured. **State** is stored one object per **Environment** under the configured prefix, so deploying two environments at once never puts them in contention. A missing object reads as no **State**, so a first **Deploy** into an empty bucket succeeds, while a corrupt one fails rather than collapsing to empty **State**. A bucket that does not resolve surfaces as `stateNotFound` and a credential the store refused as `stateAccessDenied`; no credential resolving at all, and any refusal the backend does not recognize, arrive as `pluginStateBackend` carrying the S3 error code and HTTP status.

- Migrate a Mantle project whose state has only ever lived in a bucket, with nothing to download first. `bedrock migrate` now offers this **Backend** as the place the previous tool's state is read from: it asks for Mantle's own `state.remote` block - the bucket, the region, the key it stored the state under, and the endpoint its custom-region form names for an S3-compatible store like Cloudflare R2 - and reads the object Mantle keyed `<project>.mantle-state.yml`, whether or not the answer already carries that suffix. Core still parses the Mantle format; this **Backend** only moves the bytes.

  Migrating onto this **Backend** records what that block said instead of asking for the same bucket again, custom-region endpoint included, and the project name Mantle keyed its object by becomes the `prefix`, so two projects that shared one bucket under Mantle stay apart rather than both writing `production.json` at the root. A migration onto a bucket the state was not fetched from asks for the bucket, the region, and an endpoint that may be skipped. Credentials resolve exactly as they do for a **Deploy**.

- Prove the store honours conditional creates before relying on one for exclusion. Before the first hold of a deploy is taken, the backend writes a scratch object under `<prefix>/locks/.probe-<id>.json`, writes it again requiring the object to be absent, and reads the store's refusal of that second write as the proof. The scratch object is taken away once the store has answered, and the question is asked once per deploy however many holds follow it.

  A store that takes the second write evaluated no condition, so it would hand every run that asks the same hold. That store gets no locking: the deploy stops with a `conditionalWritesIgnored` failure naming what the store did and what it means, rather than running unprotected. A deploy the user expected to be held is never quietly downgraded to one that is not. A store that could not be asked at all is refused on the same terms as `conditionalWritesUnproven`, carrying what it answered.

  A store the probe could not reach at all answers nothing about itself, so that outcome is not held on to: the next hold asks again rather than inheriting a refusal the store never really gave.

  The documented IAM policy now grants `s3:DeleteObject` alongside `s3:GetObject` and `s3:PutObject`, which is what lets the probe take its scratch object away. Without it the probe still answers, and the scratch objects are left for the lifecycle rule that expires the locks beside them.

- Report who holds an **Environment** and take a hold away, which is what core now asks of a **Backend** that locks. `inspect` reads the lock object without writing anything and without the conditional-write probe: a read-only caller asking who holds an **Environment** should not be refused by a question about exclusion it never asked. A tombstoned record and a **Lease** the clock has passed both read as nobody holding it, on the same terms acquisition reads them, so a preview never warns about a hold the next deploy would take over. A lock object the credential may not read is reported as a failure rather than as an unheld **Environment**.

  `forceRelease` writes the same tombstone a release writes, conditional on the bytes the hold was read as, so a holder that released in the meantime and a run that took the **Environment** over since are both left alone: what would be displaced is then not what was reported. A hold the store named no entity tag for is refused rather than taken away blind, on the same terms acquisition refuses a hold it could never give up safely. An **Environment** nothing is holding is left exactly as it is.

- Give a hold on an **Environment** a renewable **Lease**, so a **Deploy** killed by a cancelled CI job no longer blocks every later deploy behind manual intervention. The lock record now carries the instant its lease runs out on, stamped as the winning write goes out, and the hold renews it on a schedule of its own for as long as the deploy runs. A hold whose lease is still being renewed is never taken over, however long the deploy holding it runs; a hold nothing renews past its deadline is taken over by the next acquisition, through the same conditional write a tombstone is taken over with, so two waiters racing for one expired hold cannot both win it.

  The new `lockLeaseMs` state key sets how long a hold is leased for, defaulting to one minute, with one second the shortest accepted: a lease no round trip fits inside is one every deploy loses its own hold under. A hold the store answers a whole lease later is refused rather than handed back, since the deadline is stamped as the write goes out and a hold born past it is one the next acquisition may take over at once. Each renewal, and the release, is written against the entity tag the last renewal answered with, so a hold this run no longer has is never overwritten. A store that refuses one renewal for a reason a later one might not meet leaves the hold standing until its own deadline, and a renewal the store takes without naming an entity tag is read back for one, on the same terms acquisition reads its own landed write back. A renewal the store refuses the condition of, a read back that names no tag either, and a deadline that passes with no renewal landing are all reported through the new `onLeaseLost` so a run whose hold is gone never carries on as though it still held the **Environment**. Its **State** write is refused as a `stateConflict` rather than overwriting whatever the run that took over recorded.

- Lock the environment a deploy is reconciling, so two CI jobs pointed at one environment are serialized instead of both creating resources on Roblox. The hold is a conditional create of `<prefix>/locks/<environment>.json`, under its own prefix segment so a bucket lifecycle rule can expire abandoned ones without touching state, and its record carries who took it, what for, and when. A run that finds the environment held retries with exponential backoff for five minutes by default; the new `lockTimeoutMs` state key changes that bound, and `0` refuses immediately. Each wait is reported through the **Progress port**, and giving up names who holds the environment and since when.

  Retrying carries on through a record it could not read, which is the read contention itself breaks: an unreadable holder still retries, and a holder that releases mid-wait ends in acquisition. A credential that is *refused* the record ends the wait at once instead, so a missing `s3:GetObject` is reported as itself rather than as five minutes of contention. A record found in the way is compared against the acquiring run's own identity first, so a conditional create that landed and was reported as refused is not mistaken for someone else's hold, and a holder that a later round finds gone stops being named as the one in the way.

  Release writes a tombstone conditionally over the exact bytes the hold was taken as; the lock object is never deleted, because conditional delete is not portable across S3-compatible stores. A store that answers the winning write without an entity tag is given no hold at all, since a hold with nothing to write the tombstone against could never be given up safely.

  The run is recorded as `BEDROCK_LOCK_OWNER` when that is set, as the URL of the GitHub Actions run when `GITHUB_RUN_ID` is, and as the local user otherwise. `createS3StateLockPort` builds the port directly for a caller that wants one outside a deploy, and a hold that cannot be taken carries an `S3StateLockErrorDetail` payload naming the lock object, what went wrong, and on a timeout who held the environment and for how long.

- Updated dependencies:
  - @bedrock-rbx/core@0.2.0
