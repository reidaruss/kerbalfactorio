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

## Addendum, same day 16:47-17:30: raising the timeout does not rescue the census

After a desktop reboot severed the first session, a 6-probe sample was re-run
**serially** (one probeall, no shards) with the per-probe timeout raised from
240s to **600s**, against the same build. Probes chosen because BT-40 had
already measured four of them on Reid's Windows desktop, so the results are
comparable to a prior measurement rather than to nothing.

**Four of six exceeded even the 600s timeout**: `animgate.js`, `apexec.js`,
`assembler.js`, `post.js`, all `NO_OUTPUT`, all SIGKILLed at 600s. The run was
stopped after the fourth.

Two things follow, and the second is the one that matters.

1. **Raising the timeout is not the fix.** 600s is 2.5x the original budget and
   these four still did not finish.

2. **The box was NOT quiet, and "serial" was not serial.** `verify/research`
   was running its own `run.mjs` + headless Chrome throughout, and two
   SwiftShader GPU processes were sitting at ~1053% and ~698% CPU with a load
   average of ~20 on 30 cores. So this sample measured **two concurrent probe
   processes box-wide**, not one. The ceiling is therefore reached at **2**
   concurrent headless-Chrome probes on this box for this probe population,
   not at the 4 the first round used, and not at the "3 to 4" that
   state-of-the-union §7.4 budgets for headless Chrome probes generally.

**There is still exactly one genuinely uncontended datapoint in this whole
effort**: `aerialrange.js`, run alone at 06:03 with zero other Chrome
processes and a 1-minute load average of 2.88, finished in **3m03s wall on
2.4s of CPU** with a real verdict. Everything else was measured against a
busy box. **The uncontended per-probe cost of this suite is still unknown**,
and no scheduling decision should be made from these numbers until one lane
has the box to itself.

Worth flagging to whoever owns the probes rather than the harness: BT-40
recorded `apexec.js` (6 failures) and `post.js` (4 failures) as probes that
**completed** and returned verdicts on Reid's Windows desktop, where ANGLE
runs on D3D. Here, on SwiftShader, neither finishes in 600s. That gap is a
platform property, not a probe defect, and it decides whether this suite can
ever be a gate on this VM.
