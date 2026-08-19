# mobile-ci-kit

**CI signals you can trust on mobile.** Drop-in scripts, CI building blocks, and a written record of
the traps behind them — the ones where a gate reports success while having verified nothing.

Everything here was extracted from a working Capacitor/iOS/Android production repo, where each trap
below was found the hard way. The traps are the point; the code is what enforces them.

Requires POSIX `sh` and `awk`. No `jq`, no Python, no Node. MIT — copy any file into your own repo.

---

## The trap index

Every entry is a real observed failure, not a hypothetical.

| Symptom | Actual cause | Guard |
| --- | --- | --- |
| `xcodebuild test` prints a suite tree where every line says `passed`, and `Executed 0 tests` | Test host crashed on launch; XCTest restarted it with nothing left to run. No `** TEST FAILED **` is printed, and the word `crash` never appears | [`bin/ios_test_result_check`](bin/ios_test_result_check) — assert the executed count |
| iOS suite green for a month, one test file never ran | The `.swift` file was on disk and reviewed, but absent from the Xcode target in `project.pbxproj` | [docs](docs/false-green-tests.md#before-the-run--assert-on-the-scheme) — assert disk files vs target |
| iOS suite green, zero tests run, scheme looks fine in Xcode | Shared scheme lost its `<TestableReference>`, or has one marked `skipped = "YES"` | [docs](docs/false-green-tests.md#before-the-run--assert-on-the-scheme) — assert the scheme before building |
| A compile error under `src/androidTest/` never fails CI | `:app:assembleDebug` does not compile the `androidTest` source set. "The compile gate is green" ≠ "the tests pass" | [docs](docs/false-green-tests.md#android-the-fourth-mechanism) — run `assembleDebugAndroidTest` *and* `connectedDebugAndroidTest` |
| A test-count parser is correct in dev and wrong in CI | `xcresulttool` summaries are **not flat**: `devicesAndConfigurations[]` repeats the counts per destination. A whole-text scan reads a per-device count as the run total. The first draft was written against an *empty* bundle, where that array is `[]` | parse top-level members only — see the `summary_counts` awk in the script |
| A required gate goes permanently red one day, for no code change | `--schema-version` was pinned; Apple retired that version, and CI's Xcode auto-upgrades | don't pin it — assert on the count **fields** and fail closed |
| A required gate was silently switched off | An `ALLOW_ZERO_TESTS`-style env var set in a workflow step, with nothing detecting it | refuse the escape hatch when `CI` is set |
| A CI lint finding nobody can reproduce locally | The linter was installed unpinned (`apt-get install shellcheck`). Versions emit **different check IDs for the same code** — 0.9.0 flags `SC2317` on a trap-invoked function's body where 0.11.0 flags `SC2329` on its declaration — so `# shellcheck disable=` directives stop matching | [`ci.yml`](.github/workflows/ci.yml) — pin the version, **assert the pin took effect**, and lint under every version you claim to support |

Full reasoning: **[docs/false-green-tests.md](docs/false-green-tests.md)**.

---

## `bin/ios_test_result_check`

Fails an iOS test run that executed nothing.

```sh
xcodebuild test -resultBundlePath build/result.xcresult ...
bin/ios_test_result_check build/result.xcresult
```

Exit codes are deliberately distinct, because collapsing them costs a day of debugging the wrong
thing:

| Code | Meaning |
| --- | --- |
| `0` | at least one test really executed |
| `1` | **the gate firing** — the run tested nothing |
| `2` | usage error |
| `3` | **indeterminate** — no bundle, `xcresulttool` failed, schema changed, or a count is unreadable. Fails closed |

`3` is not a variant of `1`. "I could not read the result" and "I read it and nothing ran" are
different claims, and only the second is a verdict about your tests.

`--summary-json <file>` reads a summary already on disk instead of a `.xcresult`. That mode exists so
the assertions are testable without Xcode — it is the same parse and the same assertions, so the
tested path *is* the production path.

`IOS_TEST_ALLOW_ZERO_TESTS=1` downgrades `1` to a loud warning for local and ad-hoc runs. It never
suppresses `3`, and it is **refused when `CI`/`GITHUB_ACTIONS` is set**.

---

## Tests, and why they are mutation-tested

```sh
tests/ios_test_result_check_test    # 46 assertions, no Xcode needed, runs on Linux
```

A guard that cannot fail reports success exactly like a working one — which is the bug this repo is
about, one level up. So the suite is checked by mutating the script and confirming it goes red.
Currently caught:

| Mutation | Caught by |
| --- | --- |
| drop `expectedFailures` from the executed sum | `a run of only expected failures counts as having run` |
| stop distinguishing an all-skipped run | `an all-skipped run fails` |
| let the opt-out suppress an unparseable count | `the opt-out does not suppress an unparseable count` |
| stop refusing the opt-out under CI | `the opt-out is refused when CI is set` |

Three disciplines are baked into the suite, each earned by an assertion that passed while covering
nothing:

1. **Control assertions.** A script that rejected all input would satisfy every negative case, so a
   realistic passing run is asserted first, and the opt-out cases are bracketed by one proving the
   same fixture fails again once the flag is unset.
2. **Fixture validity.** A fixture that is accidentally invalid JSON passes the negative cases for
   the wrong reason and guts the positive ones. Well-formed fixtures are validated, and the guard
   announces itself when it cannot run rather than passing quietly.
3. **Non-cancelling traps.** The brace fixture uses deliberately *unbalanced* closers — a balanced
   pair cancels out, so a parser with no string tracking re-syncs to the same depth and produces
   identical output. The assertion passes while covering nothing.

---

## Adopting it

**Just the script.** Copy `bin/ios_test_result_check` into your repo, call it after `xcodebuild test`
with `-resultBundlePath`. No dependencies beyond POSIX `sh`, `awk`, and Xcode 16+. Copy
`tests/ios_test_result_check_test` too if you want the assertions to keep holding.

**Just the reasoning.** `docs/false-green-tests.md` stands alone. If you only change one thing after
reading it, assert an executed count.

The scripts are linted under **shellcheck 0.9.0 and 0.11.0** on every push, because "clean under
shellcheck" is a claim about more than one version and these two disagree about the same code. An
untested compatibility claim is the kind of thing this repo exists to argue against.

---

## Roadmap

Present today: the false-green guard, its suite, and the write-up. Planned, and deliberately **not**
described here until each has a green CI run behind it:

- A composite action for Android instrumentation tests on an emulator, carrying the measured tuning
  (KVM permissions, disk reclaim before boot, why the AVD is *not* cached).
- A WebdriverIO + Appium harness against local emulators/simulators, with the provider boundary kept
  thin enough that a device farm is a config change rather than a migration.
- The portable subset of a larger CI trap index (`if: always()` making a job uncancellable; a new
  gate being advisory-only until wired into two places; `awk` being mawk on Ubuntu).
