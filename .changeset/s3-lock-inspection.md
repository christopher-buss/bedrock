---
"@bedrock-rbx/state-s3": patch
---

Report who holds an **Environment** and take a hold away, which is what core now asks of a **Backend** that locks. `inspect` reads the lock object without writing anything and without the conditional-write probe: a read-only caller asking who holds an **Environment** should not be refused by a question about exclusion it never asked. A tombstoned record and a **Lease** the clock has passed both read as nobody holding it, on the same terms acquisition reads them, so a preview never warns about a hold the next deploy would take over. A lock object the credential may not read is reported as a failure rather than as an unheld **Environment**.

`forceRelease` writes the same tombstone a release writes, unconditionally: a hold being taken away is one whose holder is not coming back to give it up. An **Environment** nothing is holding is left exactly as it is.
