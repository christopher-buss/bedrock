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

| File                       | Role                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `state-schema.ts`          | Arktype fragment for the `state` keys this **Backend** adds, plus its config type. |
| `object-key.ts`            | Pure key layout: one object per **Environment**, and the lock beside it.           |
| `lock-record.ts`           | What one lock object holds, and reading it back.                                   |
| `lock-failure.ts`          | How a hold that could not be taken or given up is reported.                        |
| `lock-owner.ts`            | Pure reading of the environment into the run a hold is recorded as.                |
| `backoff.ts`               | Pure retry schedule for a contended acquisition.                                   |
| `s3-client.ts`             | The configured client both ports send through, plus the coordinates it needs.      |
| `classify-failure.ts`      | Pure reading of what the client threw into this **Backend**'s own terms.           |
| `fetch-request-handler.ts` | Smithy request handler routing the real client through an injected `fetch`.        |
| `s3-state-adapter.ts`      | The `StatePort`: reads and writes objects, reports refusals as `StateError`.       |
| `s3-state-lock-adapter.ts` | The `StateLockPort`: takes a hold by conditional create, releases by tombstone.    |
| `plugin.ts`                | The declaration core registers, and the default export a user names.               |

`src/index.ts` publishes the plugin contract and the adapter, not the mechanics
underneath them. Everything it exports is semver-bound and carries `@since`;
keep `objectKeyFor`, `lockKeyFor`, `classifyS3Failure`, the lock record, the
owner reading, the backoff, the failure constructors, and the request handler
internal.

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

The lock's clock is injected (`now`, `sleep`), so a test drains a five-minute
timeout instantly and the instants a record carries are the same on every
machine. The identity one acquisition writes is injected too (`mintId`), so a
test can state which record it expects to find.

`vite.config.ts` drops the `module` resolve condition. The AWS SDK's `module`
build imports its own files without extensions, which only a bundler resolves;
without the override every test importing the client fails to load.

## Not here yet

The lease that expires an abandoned hold, the probe that proves a store honours
conditional writes, and the conditional **State** write that fences a holder
which outlived its lease are all ADR-031 and all still to come. The conditional
write needs a version token `StatePort` does not carry yet, so this **Backend**
writes **State** unconditionally, exactly as the Gist **Backend** does. Migrate
support (`migratePrompts`, `migrateSource`) is tracked separately.
