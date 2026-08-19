# CI traps where the symptom points somewhere other than the cause

Every entry below is a failure whose *first* plausible explanation is wrong. That is the selection
criterion: none of these are "remember to do X", they are all "you will spend an afternoon looking at
the wrong file".

**Provenance is stated per entry**, because a trap index is exactly the kind of document that
accumulates plausible-sounding folklore:

| Mark | Means |
| --- | --- |
| **gate** | enforced by a check in this repo — the trap cannot recur here silently |
| **measured** | reproduced while building this repo, with the numbers or output shown |
| **observed** | recorded from a production repo where it actually happened; **not** re-reproduced here |

---

## Shell and tooling portability

### `awk` on Ubuntu is mawk, so a check validated on a Mac is unvalidated — **gate**

macOS ships one-true-awk (BSD); Debian/Ubuntu's `/usr/bin/awk` is mawk. They are not
interchangeable — mawk's ERE interval-quantifier support (`{n,m}`) cannot be relied on, and the
failure mode can be a silent "matched nothing" rather than an error. So a check script written and
tested locally on a Mac is **unvalidated for the runner that enforces it**.

Measured while building the gate: injecting gawk's `gensub()` into one guard turns the mawk leg red
while the gawk leg stays green *on identical code*. That divergence is why the matrix exists rather
than a single job.

Enforced by the `awk-portability` matrix over mawk and gawk. A third implementation is covered without
a job — the iOS lane runs on macOS, so BSD awk is exercised there. busybox awk is deliberately **not**
a leg: no brew formula, so it cannot be dry-run locally, and a gate whose first execution is in CI is
how this repo's own shellcheck-version bug got in.

The same caution applies to `sed -i` (BSD needs an argument, GNU does not), `grep -P` (absent on BSD)
and `readlink -f`.

### POSIX `sh` has no `pipefail`, and a mid-pipeline failure reads as an empty result — **gate**

In `a | b | c` only `c`'s status survives. `set -e` inside a stage kills only that stage's subshell,
so the pipeline exits 0 and the consumer sees an empty stream — **indistinguishable from "found
nothing"**. `set -o pipefail` is bash/zsh, not POSIX, and unavailable under `#!/bin/sh`/dash.

The sharper version is worse than a missing result: two failed reads both yield `""`, so `"" = ""`
reports "same" and the caller acts on a conclusion it never computed. `[ "$(f a)" != "$(f b)" ]`
discards both exit statuses, even though a plain `x=$(f)` *does* propagate under `set -e`.

Two related shapes: a `while` loop on the right of a pipe runs in a subshell, so any counter it keeps
is discarded; and `while IFS=<tab> read -r a b c` is not equivalent to `awk -F'\t'`, because tab is
IFS *whitespace* — `read` collapses adjacent tabs and silently drops a final line with no trailing
newline.

Already enforced: `shellcheck --shell=sh` reports **SC3040** for `set -o pipefail` in a `sh` script,
verified under both pinned versions (0.9.0 and 0.11.0). This was going to be a `checkbashisms` gate
until measurement showed `checkbashisms` **misses** `set -o pipefail` entirely and, across ten
bashism probes, caught nothing shellcheck did not — so the extra dependency was dropped rather than
added for the appearance of coverage.

### An unpinned linter is a reproducibility hole — **measured**

Different versions emit **different check IDs for the same code**, so a `# shellcheck disable=`
verified locally can name an ID the CI version never emits. See the README trap index; this repo hit
it on its first push.

Its general form is worth stating: **a tool that gates CI and is not version-pinned makes findings
unreproducible in both directions** — CI reports things nobody can see locally, and local suppressions
silently stop matching.

### The same tool pinned in two places, neither covering the other — **observed**

A version file consumed only by CI actions plus a separate pin consumed only by the local dev shell
(nix/asdf/mise/`.nvmrc`) look like one pin and are two. Neither covers the other's path, so CI and
local drift while both appear pinned. Checkable directly: read both values and fail if they disagree.

---

## git

### `git push` to an existing ref at the same sha exits 0, so it cannot be a lock — **observed**

Three cases, and the middle one is the trap:

| Push | Result | Exit |
| --- | --- | --- |
| new ref | `[new reference]` | 0 |
| existing ref, **same sha** | `Everything up-to-date` | **0** |
| existing ref, different sha | non-fast-forward rejection | 1 |

The same-sha case is the *common* one, because two sessions branching from the same tip push the
identical sha — so both are told "up to date" and both believe they created it. Anything using a git
ref as a claim or distributed lock is broken by this and looks fine.

The correct primitive is GitHub's create-ref endpoint, which is a true compare-and-swap:
`POST /repos/{owner}/{repo}/git/refs` returns **201** for a new ref and **422 "Reference already
exists"** for an existing one, *regardless of the sha passed*. Observed: four concurrent claimers
received four distinct results.

### `gh` resolves its repo from `$PWD`, not from your script's `git -C` — **observed**

A script that carefully does `git -C "$repo_root" …` and then calls bare `gh pr list` is reading **two
different repositories** when invoked from anywhere else. This produced a real bug in which a hermetic
test fixture's baseline came back as the *live* repository's value. `cd` to the repo root first.

### `GIT_DIR`/`GIT_INDEX_FILE` leak into hook children in a linked worktree — **observed**

Committing inside a linked worktree exports **absolute** `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE`,
`GIT_OBJECT_DIRECTORY` and `GIT_COMMON_DIR` to hook children. Any hook-invoked script that itself
shells out to git — a linter running `git diff`, a scratch `git init`, SwiftPM calling git — inherits
them and silently operates on the *committing* repository instead of its own.

**A plain checkout never reproduces it**, because it only exports a relative `GIT_INDEX_FILE`. Two
observed symptoms, neither pointing at the cause:

* a commit that fails **after** the hooks print `Passed`, with staged blobs unreadable
  (`fatal: unable to read <sha>`); recovery is `git read-tree HEAD` and re-stage.
* an unscrubbed scratch `git init` reinitialising the real repository and flipping `core.bare = true`,
  breaking every worktree with `fatal: this operation must be run in a work tree`; recovery is
  `git -C <main-checkout> config core.bare false`.

Unset all five before the first git call in any hook-invoked script.

### A grafted commit reports every file as *added*, so anchor-reachability is a false-pass — **observed**

Two tempting shallow-history tests are both wrong. `git rev-parse --is-shallow-repository` is too
strict: it stays `true` forever after any `--depth` clone, even once deepened. The alternative — "prove
history is complete by checking a known old commit is reachable" — is too lax: a grafted commit has no
recorded parents, so git diffs it against the empty tree and reports **every path as `A`**. On
`git clone --depth 1`, `git log --diff-filter=A -- <path>` returns the single grafted commit, so an
anchor-reachability guard passes at 100% missing history.

Instead: find the oldest apparently-adding commit and require it to have a parent
(`git rev-parse --verify <anchor>^`). And test such a guard against a real
`git init && git fetch --depth 1`, never a hand-built fixture — a fixture that merely omitted the
anchor file exercised a different code path and passed either way.

Distinct from the `--depth=1` graft hazard in [`bin/gha_stop_if_superseded`](../bin/gha_stop_if_superseded),
which is about an unconditional shallow fetch poisoning an already-full checkout.

### `.gitattributes` merge drivers are client-side only — **observed**

A `merge=union` rule (or any custom driver) is honoured by local git and **ignored** by GitHub's
server-side merge, squash-merge and conflict detection. An append-only file protected this way still
conflicted between two parallel PRs.

The control test is two commands: `git merge-file -p <ours> <base> <theirs>` exits 1 with conflict
markers on two appended lines, while `git merge-file --union -p` exits 0 — proving the driver works
locally and therefore proves nothing about the platform.

---

## GitHub Actions platform

### `startup_failure` with `jobs: []` is a platform refusal, not a YAML bug — **observed**

The run was blocked before scheduling — usually the actions allowlist. Re-reading the workflow YAML is
wasted time; there is no YAML that would have run. Two neighbours in the same family: `yes | sdkmanager
--licenses` can fail under `pipefail` from an ordinary broken pipe rather than a real licensing
problem, and SARIF upload or Dependabot checks can fail from repository entitlement or secrets policy
rather than from the code being scanned.

### A draft PR gets no CI, and the skip reads as a pass — **observed**

With jobs gated on non-draft, a draft PR's run completes in seconds, the aggregating required check
reports `conclusion: "skipped"`, and the rollup shows `COMPLETED/SKIPPED` next to
`mergeable: MERGEABLE`. Converting an already-green PR to draft and pushing again silently produces
nothing for that push. **Never read a rollup without also reading `isDraft` and confirming the head
sha matches** the commit you care about.

### A job is advisory-only until it is wired into *two* places — **observed**

Where a single required check aggregates a path-classified matrix, the aggregator's `needs:` list and
its separate per-output required-set must **both** name a job. Listed in one but not the other, the
job's failure is silently non-blocking — it runs, it goes red, and nothing is prevented.

The generic check is four assertions: every job id appears in the aggregator's `needs`; every job id
appears in some required-set; everything the required-set references is also in `needs`; and every
required-set key is a real declared classifier output. Deliberately-advisory jobs belong on an explicit
allowlist with a comment, so "advisory" is a decision rather than an oversight.

### `if: always()` makes a job structurally uncancellable

Already documented where it is load-bearing:
[`bin/gha_cancel_run`](../bin/gha_cancel_run) and
[docs/emulator-in-ci.md](emulator-in-ci.md). Use `!cancelled()`.

---

## Builds that exit 0 while lying

### A CLI can exit 0 with cached data when the resource is unreachable — **observed**

Verified against a phone with no transport at all: the device-info query returned **exit 0** and a
complete-looking record, with a `lastConnectionDate` a day old, while the service underneath was
unreachable. The reliable tells were specific liveness fields (`tunnelState`/`transportType` reading
`unavailable`/`null`), never the exit code.

Generalises well beyond Apple's tooling — `kubectl get`, cloud describe-calls and anything with a
local cache can do this. **Assert on a liveness field; never on exit status.**

### A local build can silently rewrite a committed lockfile — **observed**

Running the local test/build target re-resolved dependencies and left a tracked modification to the
lockfile (observed bumping a dependency 1.0.4 → 1.0.5), sweeping an unreviewed bump into an unrelated
PR. Check `git status` after any local build; the same shape appears with `go.sum` and
`package-lock.json`.

### A generated file that is only correct because something regenerates it is not a source file — **observed**

A tracked-but-generated project file named a dependency version the lockfile had already moved past,
and nothing failed — because every build path regenerated it first. The staleness surfaced only as
unexplained diff noise in unrelated PRs. Either gitignore it and assert regeneration is idempotent, or
gate it with regenerate-then-`git diff --exit-code`.

### Hooks are not installed in a fresh clone or worktree — **observed**

`.git/hooks` holds only `.sample` files until someone runs the install step. So a formatter that would
have caught drift never runs, and typecheck + test + lint all pass locally while CI fails on format —
because none of those three invoke the formatter. **A green local run without the formatter is not
evidence of a green CI run.** Verify the hook is not a `.sample` stub before trusting local green.

---

## Devices and parallelism

### Unscoped `adb` can install onto a physical device instead of the emulator — **observed**

`connectedDebugAndroidTest` installs onto whichever device `adb` happens to pick. With a phone
attached — including one reachable over network adb — an unscoped run installs onto real hardware and
changes its state. Pass `-s <serial>` and set `ANDROID_SERIAL`; treat both as mandatory rather than
tidy. Checkable: fail the invocation when `adb devices` lists more than one entry and neither was set.

### A build cache keyed only by `$TMPDIR` is shared by every worktree — **observed**

Derived-data-style caches with no worktree identity poison parallel checkouts. Two worktrees pinned to
different dependency versions left artifacts from one resolving against the other's manifest, and the
error was a **missing `Info.plist` inside a framework** — which reads as a broken checkout, a bad
merge, or a missing dependency, and not as a caching problem. Observed twice, the second time as
cross-worktree version skew after four worktrees built in one day.

Either embed a worktree identity in the cache path, or serialise builds across worktrees. The same
applies to any global cache — Gradle's, Bazel's disk cache, npm's.

### Concurrent headless Chrome sharing a profile silently emits 0 bytes — **observed**

Two headless Chrome processes against the same `--user-data-dir` contend on the profile lock, and the
loser **emits zero bytes with no error**. That looks exactly like a network block or a hostile site,
so the investigation starts at the firewall. Use a fresh profile directory per invocation.

---

## What is deliberately not here

Traps that depend on one repository's structure — its build-system module layout, its ticket
numbering, its worktree tooling — were dropped rather than rewritten into something vague. A trap
index earns trust by being specific, and a generalised trap is usually just advice.
