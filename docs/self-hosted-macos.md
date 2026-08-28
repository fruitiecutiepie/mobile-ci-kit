# A self-hosted macOS runner, where the Xcode build hangs and reads as slow

Running the iOS lane on your own Mac is the usual answer to hosted macOS minutes. The trap is in the
first hour of standing one up, and it costs a day because the failure mode is a timeout rather than
an error.

**Provenance: observed.** This was measured on a real self-hosted Mac in a production repo, with the
numbers below. It is not reproduced by this repo's CI, and it cannot be: the fix lives on a machine,
not in a file. That is half the point of the page.

## The symptom, which does not look like a hang

The build starts normally. A couple of hundred lines go by. It gets through `CreateBuildDescription`
and the `ExecuteExternalTool` toolchain probes, so you see `clang -v -E -dM`, `actool`, `ibtool` and
`ld` all report in. Then the output stops.

Nothing else is printed until the job timeout kills it. No `CompileSwift`, no `CompileC`, no `Ld`.
The runner's own `_diag/Worker_*.log` shows only its ten-second heartbeats across the whole gap, so
the runner is alive and the job is not.

Because the job dies at the cap, the natural reading is that the build is too slow and the fix is a
larger `timeout-minutes`. That reading is wrong, and acting on it makes things worse: a blocked build
holds the single Mac for however long you raised the cap to.

## The cause

GitHub's runner service installer writes a LaunchAgent at

```
~/Library/LaunchAgents/actions.runner.<owner>-<repo>.<name>.plist
```

and that plist contains `SessionCreate: true`, alongside `ProcessType: Interactive`. `SessionCreate`
gives every job its own security session instead of the logged-in Aqua session. Xcode's build
machinery blocks in that context.

## The measurements

Same machine, same Xcode, cold DerivedData in every row. The trigger was a comment-only change to a
single Swift file, chosen because it routes to the smallest set of jobs.

| Context | Result |
| --- | --- |
| Runner agent, `SessionCreate: true` | killed at the 35-minute cap, 2 of 2 attempts |
| Interactive shell in the logged-in GUI session | `** BUILD SUCCEEDED **` in 3m23s |
| Runner agent, `SessionCreate: false` | success in 6m05s, including the XCTest step |

The middle row is what turns a suspicion into a diagnosis. Without it you have a slow build and a
fast build on the same machine, which is consistent with contention. The third row is what rules
contention out: same agent, same queue, one plist key different.

## The fix

Set `SessionCreate` to `false` in that plist, then reload the agent:

```sh
launchctl bootout "gui/$(id -u)/actions.runner.<owner>-<repo>.<name>"
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/actions.runner.<owner>-<repo>.<name>.plist
```

The agent still runs as the logged-in user. It just stops asking for a session of its own.

## Read the output rate, not the elapsed time

This is the part that transfers to every long CI job, not only Xcode ones.

Bucket the job log into lines per minute. Steady compile lines at a low rate means the build really is
slow, and a bigger timeout is the right call. A flat gap with no output at all means the build is
blocked, and no timeout is large enough. The two states look identical if you only read the wall
clock, and they take seconds to tell apart once you look at the rate.

The whole diagnosis above is that one measurement. Everything else was confirming it.

## The fix is machine state, not repo state

Nothing in version control asserts this. There is no diff, no gate, and no check that can fail.

So it comes back. Re-running the runner's `config.sh`, reinstalling the service, or moving to a new
Mac all rewrite the plist with the installer's default, and the hang returns with no change on any
branch. Anyone standing up a self-hosted Mac lane should read the plist first when Xcode jobs time out
with no compile output, before touching timeouts, caches or the Xcode version.

If you keep a runbook for the machine, this key belongs in it. A repo-side guard is not available.

## Copy the log before you re-run

Re-running a job **overwrites its record in place**. The original timing is gone, and with it the
evidence you need to compare attempts.

That is how the first attempt here got misdiagnosed as runner contention: the two capped runs were
compared against a memory of the earlier one rather than against its log. Copy the log out, then
re-run.

Merging a PR does not destroy run history. Only re-runs do.
