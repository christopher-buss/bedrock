# ADR-034: Capacity Check and Deferred Creates

**Date:** 2026-10-27 **Status:** Accepted

Decision Makers: Maintainer

Tags: core, config, diff, apply, badges, quota, environments

## Context

Roblox caps some creates and on-sale transitions per universe, and the caps are
not visible in config or State:

- **Badges.** Each universe gets 5 free badge creates per 24-hour GMT period;
  each further create costs 100 Robux. A live probe on 2026-10-27 confirmed the
  quota drops by exactly one per create, and that a create sent with
  `expectedCost: 0` once the quota is spent is refused with
  `403 {"errors":[{"code":18,"message":"Expected badge cost is different from the actual badge cost."}]}`
  and charges nothing.
  `GET badges.roblox.com/v1/universes/{universeId}/free-badges-quota` returns
  the remaining count as a bare integer. It needs no authentication, shares a
  60-requests-per-60-seconds budget per caller, and its `retry-after` header is
  wrong: the window reopens only at `x-ratelimit-reset`. No response states when
  the quota resets.
- **Game passes.** A universe can have at most 50 game passes on sale at once.
  The project's own smoke tests established the number when they began failing;
  Roblox exposes no API for the limit or the remaining slots. The live on-sale
  count is readable through the game passes list operation.

Without a check, a Deploy finds these caps mid-Apply. Apply runs in parallel and
continues on failure
([ADR-023](./023-apply-semantics-parallel-continue-on-failure.md)), so the run
ends half-done: some badges exist, the rest fail, and Codegen emits a partial
set. In a development Environment that is acceptable, even useful: ten badges
can land as five today and five tomorrow without spending Robux. It is not
acceptable for an Environment that receives code built elsewhere. Promoting a
branch from development to staging or production with ten new badges and
creating only five breaks game code that already references all ten. The risk
follows the promotion, not the word "production", so a production-only flag
would leave staging exposed.

Bedrock has no payment config yet, so spending Robux is not an option for
closing the gap.

## Decision

1. **Capacity check before Apply.** Every Deploy (and `bedrock diff`) compares
   the creates and on-sale transitions it needs against the universe's current
   capacity before any Operation runs. A failed capacity read is retried
   (honouring `x-ratelimit-reset`, not `retry-after`) before it counts as
   failed.
2. **All or nothing by default.** If capacity falls short, or the read still
   fails after retries, the whole Deploy is refused before any Operation, Open
   Cloud write, or State write, for every Kind. The refusal reports the counts
   (needed, available) and the next reset where one is known.
3. **Deferred creates are an Environment opt-in.** `allowDeferredCreates: true`
   on an Environment overlay lets a badge shortfall become Deferred creates
   instead of a refusal. The field is not accepted in the root config: a root
   value would silently apply to every Environment added later, which is the
   promotion risk this decision exists to prevent. A root form can be added
   later without breaking anyone; removing one could not.
4. **Deferred create semantics.** With quota N, the first N badge creates in Key
   order run; the rest are deferred without a request. A Deferred create writes
   no State, so the next Deploy produces the same `create` again with no extra
   mechanism. If the quota read fails in an opted-in Environment, the Deploy
   continues, badge creates run one at a time in Key order, and a code-18
   refusal becomes a Deferred create. The Deploy succeeds with a warning listing
   deferred Keys; the Deploy result carries the list so CI can surface it.
5. **Never spend Robux.** Badge creates always send `expectedCost: 0`. A paid
   create is a later decision, alongside a payment-source config.
6. **Unauthenticated documented endpoints are allowed** where Roblox publishes
   them in its Open Cloud reference (amendment to
   [ADR-007](./007-open-cloud-only.md)). `free-badges-quota` is the first.

## Considered Options

- **Detect the cap at Apply only (code 18 / `GamePassOnSaleLimitError`).**
  Rejected as the primary signal: it fails midway, after earlier creates have
  already landed. It stays as the fallback for the race between the read and the
  create, which Open Cloud cannot close because it has no reservation step.
- **A production flag.** Rejected: staging has the same promotion risk.
- **Deferral on by default, opt-out per Environment.** Rejected: a new
  Environment would start in the unsafe mode.

## Consequences

- The capacity check is a cross-Kind step in the Deploy pipeline. Each Kind with
  a per-universe cap contributes a read and a demand; Kinds without one
  contribute nothing.
- A read can go stale between check and Apply. A code-18 refusal in an
  all-or-nothing Environment is a failed create; creates that succeeded keep
  their State, and the next Deploy finishes the work.
- The game pass limit of 50 is a constant in code, because Roblox exposes no
  value to read. If Roblox changes it, the constant must change too; the
  existing Apply-time rejection still catches the mismatch.
- The free-quota reset time is not returned by any response. Reports state the
  next 00:00 UTC, which the vendored spec implies but a live probe has not yet
  confirmed.
- Codegen in an opted-in Environment can be partial until the deferred badges
  are created. That is the accepted trade for development Environments.
