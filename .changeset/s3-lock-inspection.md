---
"@bedrock-rbx/state-s3": patch
---

Report who holds an **Environment** and take a hold away, which is what core now asks of a **Backend** that locks. `inspect` reads the lock object without writing anything and without the conditional-write probe: a read-only caller asking who holds an **Environment** should not be refused by a question about exclusion it never asked. A tombstoned record and a **Lease** the clock has passed both read as nobody holding it, on the same terms acquisition reads them, so a preview never warns about a hold the next deploy would take over. A lock object the credential may not read is reported as a failure rather than as an unheld **Environment**.

`forceRelease` writes the same tombstone a release writes, conditional on the bytes the hold was read as, so a holder that released in the meantime and a run that took the **Environment** over since are both left alone: what would be displaced is then not what was reported. A store that named no entity tag for the read leaves nothing to condition on, and the tombstone goes as it is. An **Environment** nothing is holding is left exactly as it is.
