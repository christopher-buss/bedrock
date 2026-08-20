# ADR-031: State Concurrency Model

**Date:** 2026-08-21 **Status:** Accepted

Decision Makers: Maintainer  
Tags: architecture, state, concurrency, locking, ci, reliability

## Context

A **Deploy** reads **State**, computes a **Diff**, applies **Operations**
against Roblox, then writes **State**. The side effects land before the write.

That ordering decides everything here. When two CI jobs deploy one
**Environment** concurrently, both have already created game passes by the time
either could notice a conflict at write time. A lost write is not a lost edit;
it is bedrock forgetting that a resource it created exists, so the next deploy
creates a second one.

Object storage does not resolve this on its own. AWS states the constraint
plainly: S3 does not support object locking for concurrent writers, and where
two PUTs race, the later timestamp wins.

A survey of how comparable tools handle it produced one finding that shaped this
decision more than any other: **no surveyed tool makes the state write
conditional on the state it read.** Terraform and OpenTofu acquire a lock object
with a conditional create and then write state with an unconditional PUT.
Pulumi's self-managed backend writes the lock file with no conditional primitive
at all, relying on list-after-write consistency. Pulumi Cloud holds a renewable
server-side lease. Atlantis moves the lock into a store that has transactions
and takes it at pull-request granularity. Every one of them assumes the lock
held and has no way to detect afterwards that it did not.

The cost of locking is well documented and is almost entirely liveness. Locks
left behind by killed CI jobs are the dominant complaint; the recovery path is a
human running a force-unlock command; and that command is widely automated back
into pipelines, which returns the concurrency hazard the lock was protecting
against. Two further details are worth copying in the negative: a default
acquisition timeout of zero means no retry at all out of the box, and a retry
loop that first reads the current holder's record cannot retry when the holder
released in the meantime, which is exactly the contended case.

Under ADR-006 this is a state contract decision and a guarantee users rely on,
so it is recorded separately from the plugin runtime in ADR-030 that carries it.

## Decision

### Exclusion is taken before the work, not detected after it

An optional `StateLockPort` sits beside `StatePort`. A hold is taken on one
**Environment** before any **Operation** is applied and given up once the
**State** write has been _attempted_, whether that attempt succeeded or failed.
Lifetime belongs to the deploy shell, the only layer that knows where the
operation begins and ends.

Releasing on the attempt rather than on success matters: a write that fails
after **Apply** is exactly when the operator needs to run again, and holding the
**Environment** until the **Lease** expires would make the recovery path wait on
a timeout. The failure that carries the unrecorded resources is preserved
through release, so a release that also fails does not mask it.

Detecting a conflict at write time is too late by construction. Waiting before
touching Roblox is the entire point.

### Locking is a declared capability, not a required one

A **Backend** states whether it can lock. The Gist backend cannot offer atomic
create-if-absent and does not claim to; an object-store backend does. Core
adapts, and the CLI reports the guarantee in force.

Requiring every backend to lock would disqualify a backend already in use.
Leaving it undeclared would make the guarantee invisible at the moment a user
chooses where **State** lives.

### The hold carries a lease

The lock record carries an owner, an operation, and a deadline, renewed while
the deploy runs. A hold whose lease stops being renewed expires and may be taken
over.

This is a deliberate divergence from the tools that keep locks until a human
intervenes. Their reasoning is sound for them: a process can lose contact with
the state backend while still mutating cloud resources, and an expiring lock
would let a second run start while the first is alive. The next decision is what
makes takeover safe here.

### The state write is conditional on the state that was read

`read` yields a version token alongside the **State**; `write` is conditional on
it and fails rather than overwriting a newer record.

This changes `StatePort`, which today is `read(environment)` returning the
**State** or nothing and `write(state)` overwriting unconditionally, as sketched
in ADR-019. The change is additive: the token is optional, and a write carrying
no token is the unconditional write of today. A **Backend** whose store has no
version primitive keeps working untouched, which is what the Gist **Backend**
does. Nothing has to be migrated, and no second port version is needed.

This is the fencing token. A holder that kept running past its expired lease
cannot clobber the state written by whoever took over, because its write is
guarded independently of the lock. It is also the answer to a lock that was
never really held: a store that silently ignores conditional writes, a
force-unlock, a bug in acquisition. Every surveyed tool leaves that gap open.

### Contention retries; conflict does not

Acquisition retries with exponential backoff for five minutes by default,
configurable, with progress surfaced through the **Progress port** so a wait is
never a silent hang. Retry never depends on being able to read the current
holder's record.

A failed conditional write is terminal. Merging two divergent **State** records
is unsound: two runs that each created a game pass produce two entries that are
both correct, and no merge can distinguish "two resources" from "one resource
written twice". No surveyed tool merges state, and the absence is deliberate. On
a conflict, bedrock reports which resources were applied but not recorded,
writes the unsaved **State** to a local file, and points at a command to push it
once the operator has decided what is true.

### Locking is on by default

A backend that can lock does, unless explicitly disabled. Defaulting to no
locking, silently, is how concurrent applies produce duplicate resources with no
warning anywhere. An opt-out exists for users who serialize deploys themselves.

### Read-only commands do not take the lock

`read` does not write, so preview and diff take no hold. A preview that races a
deploy can be stale and says so. Serializing every preview against every deploy
is the most-complained-about consequence of adopting locking elsewhere, and the
justification for it does not transfer here.

### A store must prove it supports conditional writes

Before relying on conditional create for exclusion, the adapter verifies it: put
a scratch key, put it again conditionally, and require the conditional attempt
to fail. A store that returns success has silently granted two writers the same
lock, and there are S3-compatible implementations that do exactly that,
including under quorum loss.

A store that fails the probe does not get locking. Refusing to lock is better
than a lock that does not exclude.

The wildcard is sent as a bare `*`, never quoted. At least one S3-compatible
implementation compares the raw header value before stripping quotes, so a
quoted wildcard falls through to an ETag comparison, the condition evaluates as
satisfied, and the conditional create degrades into an unconditional overwrite.
That failure is silent and grants two writers the same hold.

### Release writes a tombstone

The hold is released by a conditional write marking it released, not by deleting
the object. Conditional delete is not portable: it is recent on S3, undocumented
on R2, and silently ignored by at least one S3-compatible implementation that
deletes the object anyway and reports success. A release built on it would pass
every test against S3 and delete other holders' locks elsewhere.

## Consequences

### Positive

- Concurrent deploys to one **Environment** wait rather than both applying.
- A crashed deploy's hold expires instead of blocking every later deploy, and
  the conditional write keeps that expiry safe.
- A state write can no longer silently lose a record, on any backend that
  supports conditional writes, whether or not the lock behaved.
- The guarantee a backend provides is visible when choosing one.

### Costs

- A force-unlock escape hatch is mandatory from the first release, not later
  polish. Locking without it converts every stuck hold into an unrecoverable
  deploy.
- The Gist backend keeps a weaker guarantee than an object-store backend. That
  difference is declared rather than hidden, but it is real.
- The probe adds a round trip per deploy and a scratch object.
- Lease renewal means a deploy now has periodic background work, so a hung
  process holds its lock only as long as its renewals continue.
- A partition in which bedrock can still reach Roblox but not the state store
  can still produce two runs applying at once. The lease bounds the window; it
  does not close it.

## Survey scope

The claim that no comparable tool makes the **State** write conditional on the
**State** it read is load-bearing here, so the scope behind it is recorded
rather than asserted. Surveyed on 2026-08-20, reading each tool's object-store
backend source rather than its documentation: Terraform and OpenTofu (the `s3`
backend, `use_lockfile` as shipped in 1.10 and 1.11), Pulumi (the self-managed
object-store backend, and the Cloud backend's lease behaviour), Atlantis
(pull-request-granularity locking over BoltDB and Redis), and Terragrunt (which
provisions lock resources and adds no semantics of its own).

In every one, the conditional primitive guards lock acquisition only; the state
object itself is written unconditionally.

## References

- [Terraform `s3` backend](https://developer.hashicorp.com/terraform/language/backend/s3)
  and its
  [remote-state client](https://github.com/hashicorp/terraform/blob/main/internal/backend/remote-state/s3/client.go)
- [`statemgr.Locker`](https://github.com/hashicorp/terraform/blob/main/internal/states/statemgr/locker.go)
  and the optional
  [`ClientLocker`](https://github.com/hashicorp/terraform/blob/main/internal/states/remote/remote.go)
  interface that models locking as a capability
- [OpenTofu `s3` backend client](https://github.com/opentofu/opentofu/blob/main/internal/backend/remote-state/s3/client.go)
- [Pulumi self-managed backend locking](https://github.com/pulumi/pulumi/blob/master/pkg/backend/diy/lock.go)
- [Amazon S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
  and
  [conditional deletes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-deletes.html)
- [Cloudflare R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/),
  which lists conditional operations on `PutObject` and none on `DeleteObject`
- [Stale locks left by interrupted runs](https://github.com/hashicorp/terraform/issues/25776),
  open since 2020, and the
  [lockfile retry gap under contention](https://github.com/hashicorp/terraform/issues/37324)
- [Conditional writes silently ignored under quorum loss](https://github.com/minio/minio/issues/21603)
