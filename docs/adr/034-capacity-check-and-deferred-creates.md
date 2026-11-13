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

## Amendment: 2026-11-09, payment source from the universe owner

Decision item 5 now reads: badge creates always send `expectedCost: 0`, with a
payment source from the universe owner.

Roblox rejects a badge create that has no payment source. On a user-owned
universe it answers `400` with code 16 ("Payment source is invalid."). With a
payment source of `User` and `expectedCost: 0`, the create succeeds inside the
free quota. When the quota is used up, Roblox answers `403` with code 18 and
does not charge. So `expectedCost: 0` still means Bedrock never spends Robux.

The badge driver reads the universe owner from the cloud v2 universe resource on
its first create, at most one time for each driver. A `user` owner gives `User`
and a `group` owner gives `Group`. A failed owner read fails the create; the
driver does not guess. The driver keeps a failed owner read for the deploy, so
every badge create in that deploy fails with the same error, and the next deploy
reads the owner again. Update, retire, and the capacity check do not read the
owner.

The `Group` mapping is not confirmed against the live API. It stays unconfirmed
until smoke coverage for a group-owned universe exists.

## Amendment: 2026-11-13, paid creates

Decision item 5 now reads: Bedrock spends Robux only on a **Paid create**, and
only when the Environment declares a **Spend limit** and the run gives spend
approval. Without both, every badge create sends `expectedCost: 0` as before.

### Paid create context

The original reason for this ADR now works against item 5. A development
Environment can create ten badges as five today and five tomorrow at no cost. A
new Environment that receives the same ten badges must create all ten in one
Deploy, and the capacity check refuses it. Before this amendment, the only fix
was to wait for the free quota on each day.

`scripts/probe-badge-paid-create.ts` in `@bedrock-rbx/ocale` ran against live
universes on 2026-11-13. The key was owned by a user. Each run used the free
quota first, then sent `expectedCost: 0`, then sent the live price:

| Universe owner | Payment source | Result of the paid create                  | Who paid      |
| -------------- | -------------- | ------------------------------------------ | ------------- |
| user           | `User`         | `200`, badge created                       | key owner     |
| group          | `User`         | `200`, badge created                       | key owner     |
| group          | `Group`        | `200`, badge created                       | group funds   |
| group, 0 Robux | `Group`        | `500 InternalServerError`, no badge listed | nothing spent |

Other facts the runs and the vendored spec established:

- `GET badges.roblox.com/v1/badges/metadata` returns `badgeCreationPrice` (100
  on 2026-11-13). It needs no authentication and takes no universe, so it is the
  list price, not the cost of the next create.
- With the quota at 0, `expectedCost: 0` gives `403` code 18 and no badge. The
  next send with the live price succeeds.
- Code 18 reads "different from the actual badge cost", which suggests an exact
  match. A 2022 forum report says that a send of the price while a free create
  was left charged the price and also used a free slot. That case was not
  probed.
- A group without funds answered `500`, not code 17 ("Insufficient funds").
- No Open Cloud endpoint reads a Robux balance. The currency endpoints in the
  vendored spec accept only a cookie.
- ocale asks for `legacy-universe.badge:manage-and-spend-robux` on every badge
  create, free or paid. The scope alone does not keep a key from spending.

The `Group` mapping of the 2026-11-09 amendment is now confirmed for a key owned
by a user.

### Paid create decision

1. **Spend limit on the Environment only.** `spendLimit` (Robux) is accepted on
   an Environment overlay and refused at the root, for the same promotion reason
   as `allowDeferredCreates`. It is one total for each Deploy over all Kinds.
   Badges are the only paid create today.
2. **Two keys.** A Deploy spends only when the Environment has `spendLimit` and
   the run passes `--allow-spend` (`allowSpend: true` in `deploy()`). Without
   the flag the limit is 0. The deploy action takes an `allow-spend` input that
   defaults to `false`.
3. **Live price.** Each Deploy that needs a paid create reads
   `badgeCreationPrice`.
4. **Zero first.** Every badge create sends `expectedCost: 0`. On code 18 it
   sends again one time with the live price, if the spend stays inside the
   limit. A free create is never paid for.
5. **Capacity check.** Paid creates count against the limit before Apply. With
   deferral off, a shortfall the limit cannot cover refuses the whole Deploy.
   With deferral on, creates up to the limit are paid and the rest are Deferred
   creates. When the quota cannot be read, the Deploy continues only if the
   worst case (every create paid) fits the limit, and badge creates run one at a
   time. Without spend approval, the refusal or deferral report names the Robux
   needed and the flag that would pay for it.
6. **Diff shows cost.** `bedrock diff` reports the number of paid creates, the
   price, the total, and the limit.
7. **Payment errors stop paying.** Code 17, code 28 ("You do not have permission
   to spend this group's funds."), and a `500` on a paid send stop every
   remaining paid create in the Deploy. With deferral on they become Deferred
   creates; with deferral off they are failed creates. The report for a `500`
   says that the create may have completed and charged, and asks the user to
   check the universe badges and the Robux transactions.
8. **Unconfirmed paid creates are never paid again blindly.** The create that
   got the `500` is neither a Deferred create nor a plain failed create. Bedrock
   records an **Unconfirmed paid create** marker for its Key in the State
   `$bedrock` namespace, with the badge name and the time of the send. A later
   Deploy sends no create for a marked Key. It first looks for a live badge with
   that name. If it finds one, it adopts it: it writes the State entry with the
   badge's IDs and clears the marker. If it finds none, it does not pay. With
   deferral off the Deploy is refused before Apply; with deferral on the Key is
   skipped and reported. The user then imports the badge if it exists, or
   confirms that no badge exists, which clears the marker so the next Deploy may
   pay.
9. **Payment source.** The universe owner still sets the source: `User` for a
   user-owned universe, `Group` for a group-owned one. An optional Environment
   field `paymentSource: "user"` makes the key owner pay for a group-owned
   universe. It is never needed on a user-owned universe.

### Paid create consequences

- A promotion to a new Environment can create every badge in one Deploy, at a
  cost the Environment states and the run approves.
- A local run never spends, even with a config that declares a limit.
- Bedrock cannot see a balance, so a shortfall of funds shows only at Apply.
- A `500` on a paid send is ambiguous. ocale already does not retry a create
  after a 5xx, so one Deploy cannot pay twice. The Unconfirmed paid create
  marker carries that guarantee across Deploys: no later Deploy pays for the Key
  until a live badge is adopted or the user confirms none exists.
- The public badge list hides disabled badges, so the name search can miss a
  disabled badge that Roblox made. That case ends at the user's confirmation,
  never at a second charge.
