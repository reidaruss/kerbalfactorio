# BT-8x sweep, 2026-08-12

The BT-40/BT-41 probe census, run at commit 95f7d6b (this lane's gate-authoring
commit, so the hardened runner's screenshot/context-loss/verdict fixes were in
effect for every probe run). 4 shards (`git worktree`, ports 4260-4263) for the
190 documented probes, then a 5th sequential-in-time `--nodocs` pass (also
sharded 4-way) for the 94 that document no invocation.

**Read the result with the wall-clock in hand.** Round 1 (4 shards, all 190
documented probes) ran 02:41 to 06:02, over 5x the ~30-40 min estimate, under
15-minute load average ~30 on this 30-core box (many other lanes' worktrees
were active). 196 of 200 attempted documented probes came back NO_OUTPUT
(240s timeout, SIGKILLed, no parseable report), plus all 91 nodocs attempts.

**This is a timeout/concurrency ceiling, not 196 broken probes.** A single
isolated retry of the first timed-out probe (`aerialrange.js`, no other shard
running) completed in 3m03s wall clock on 2.4s of CPU time: a real result
(one genuine console.warn failure), not a hang. Re-running all 4 shards
concurrently again, even after the box's own load had dropped to a 1-minute
average of 0.6, reproduced the same near-total timeout: 4 concurrent
SwiftShader-rendering headless Chrome instances is, on its own, enough
contention on this box to push a probe population whose serial runtime is
often 2-4 minutes past the 240s default. state-of-the-union §7.4 already
named 2 shards as the calibrated point ("60 to 70 minutes at two shards");
this sweep used 4, per the brief.

`merged-documented.jsonl` / `merged-nodocs.jsonl`: the reconciled per-probe
records (one JSON object per line, `probeall.mjs`'s own format). Round 2 was
a partial retry of just the NO_OUTPUT probes under lower load; where it
produced a real result before being stopped, that record replaces round 1's
NO_OUTPUT for the same probe. Nothing here was hand-edited.

**What to do with this**: re-run the documented-probe census at 2 shards
and/or a higher `--timeout`, off-hours if possible, before trusting the
NO_OUTPUT bucket as anything other than "not measured yet." The 4
non-NO_OUTPUT documented results (1 RED, 2 GREEN, 1 NO_VERDICT) and the
91 NO_DOCUMENTED_CMD records are real and need no re-run.
