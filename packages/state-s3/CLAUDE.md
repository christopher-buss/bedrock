# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Package Overview

`@bedrock-rbx/state-s3` is a bedrock **Plugin** that persists **State** in an S3
bucket. It is published, and it joins the fixed version group with
`@bedrock-rbx/core` and `@bedrock-rbx/ocale`, so it releases whenever they do.

The rule that shapes every decision here: this package reaches core only through
the published plugin contract. If it needs something the contract does not
offer, the contract is what changes. A privileged path taken here would make the
contract a claim rather than a proof.

## Layout

| File                         | Role                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `state-schema.ts`            | Arktype fragment for the `state` keys this **Backend** adds, plus its config type.                                     |
| `object-key.ts`              | Pure key layout: one object per **Environment**, and the lock beside it.                                               |
| `lock-record.ts`             | What one lock object holds, and reading it back.                                                                       |
| `lease.ts`                   | Pure lease arithmetic: the deadline one is stamped with, and when it has run out.                                      |
| `lease-renewal.ts`           | The hold that keeps its own lease alive until it is given up.                                                          |
| `lock-object.ts`             | Every conditional read and write the lock object itself takes, and the wildcard both it and the probe are fenced with. |
| `conditional-write-probe.ts` | Proving the store refuses a create of an object it already holds.                                                      |
| `lock-failure.ts`            | How a hold that could not be taken or given up is reported.                                                            |
| `lock-owner.ts`              | Pure reading of the environment into the run a hold is recorded as.                                                    |
| `backoff.ts`                 | Pure retry schedule for a contended acquisition.                                                                       |
| `s3-client.ts`               | The configured client both ports send through, plus the coordinates it needs.                                          |
| `classify-failure.ts`        | Pure reading of what the client threw into this **Backend**'s own terms, and the payload it is reported with.          |
| `fetch-request-handler.ts`   | Smithy request handler routing the real client through an injected `fetch`.                                            |
| `s3-state-adapter.ts`        | The `StatePort`: reads and writes objects, reports refusals as `StateError`.                                           |
| `s3-state-lock-adapter.ts`   | The `StateLockPort`: takes a hold by conditional create, releases by tombstone.                                        |
| `credentials.ts`             | Reading the key pair core's environment holds, which both a deploy and a migration sign with.                          |
| `migrate.ts`                 | What `bedrock migrate` asks for, and reading the mantle state a bucket holds.                                          |
| `plugin.ts`                  | The declaration core registers, and the default export a user names.                                                   |

`src/index.ts` publishes the plugin contract and the adapters, not the mechanics
underneath them. Everything it exports is semver-bound and carries `@since`;
keep `objectKeyFor`, `lockKeyFor`, `probeKeyFor`, `classifyS3Failure`, the probe
itself, the lock record's parsing and serialization, the lock object's reads and
writes, the owner reading, the backoff, the failure constructors, and the
request handler internal. The shapes a caller reads off a result
(`S3LockHolder`, and the failure detail types) are exported; the functions that
build and parse them are not.

## Testing

The client is never mocked. Tests inject a fake transport
(`tests/helpers/fake-s3.ts`) into the real `S3Client`, so signing, marshalling,
and error deserialization all run. Asserting against a stubbed `send` is the
"testing mock behavior instead of real behavior" anti-pattern the root
`CLAUDE.md` names, and it would leave the error-deserialization paths this
**Backend** classifies entirely untested.

Credentials are supplied per test, either as static credentials on the adapter
or through the environment core injects, so no test depends on the ambient AWS
setup of the machine running it.

The first acquisition through a port probes the store before it reaches the lock
object, and the answer is kept for the holds that follow unless the round proved
nothing. Every test builds its own port, so every test's first acquisition
probes, and a transport stating how one acquisition is answered would otherwise
be stating how it answers the probe too. `honouringProbe` in
`tests/helpers/fake-s3.ts` answers the scratch object on compliant terms and
passes everything else through, which is what keeps the two questions apart. The
probe's own unit tests live in `conditional-write-probe.spec.ts` and call
`probeConditionalWritesAsync` directly; the tests for what an acquisition does
with its answer live in `s3-state-lock-adapter.spec.ts` and build the port
unwrapped, so the transport under test answers the probe too.

The lock's clock is injected (`now`, `sleep`, `scheduleEvery`), so a test drains
a five-minute timeout instantly, renews a lease exactly when it says to, and the
instants a record carries are the same on every machine. The identity one
acquisition writes is injected too (`mintId`), so a test can state which record
it expects to find.

The migrate source is handed a **Transport** the same way the ports are, so its
tests inject the fake store rather than replacing the runtime's own `fetch`.

`vite.config.ts` drops the `module` resolve condition. The AWS SDK's `module`
build imports its own files without extensions, which only a bundler resolves;
without the override every test importing the client fails to load.

## Migrating

`migrate.ts` declares both halves of migrate support. The source's coordinates
are mantle's own `state.remote` block, and its custom-region form arrives
flattened: the region is the custom `name` and the endpoint the custom
`endpoint`. Mantle keys one object `<project>.mantle-state.yml`, so the key
answered names the project and the suffix is appended only when the answer does
not already carry it.

The translation makes mantle's own key the **Prefix**, which is what keeps two
projects that shared one bucket under mantle from both writing `production.json`
at the root. Coordinates that could not have been fetched from are refused by
throwing, which is core's own path for a translation that cannot be made.
