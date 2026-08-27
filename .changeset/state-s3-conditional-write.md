---
"@bedrock-rbx/state-s3": minor
---

Make the write conditional on the object that was read. A read carries the object's entity tag back as its `StateVersion`, and the write that follows sends it as `If-Match`; a read that found no object fences the write with a bare `If-None-Match: *`, never quoted, because at least one S3-compatible implementation compares the raw header before stripping quotes and would degrade the create-if-absent into an unconditional overwrite. A precondition failure, a concurrent-write conflict, and a record deleted between the read and the write are each reported as `stateConflict`. A write given no version overwrites as before.
