# mobile-ci-kit

**CI signals you can trust on mobile.** Drop-in scripts, CI building blocks, and a written record of
the traps behind them — the ones where a gate reports success while having verified nothing.

Everything here was extracted from a working Capacitor/iOS/Android production repo, where each trap
below was found the hard way. The traps are the point; the code is what enforces them.

The scripts require only POSIX `sh` and `awk` — no `jq`, no Python, no Node. MIT: copy any file into
your own repo.

**The headline result:** one Appium spec, selecting only on accessibility ids, passes **unchanged** on
both an Android emulator and an iOS simulator — no platform branching, no vendor SDK, and no Apple
Developer account (simulator builds need no code signing). Verified on real devices, not asserted:

```
[app-debug.apk Android #0-0]  ✓ updates the result text when the target is tapped   (1 passing)
[Minimal.app   iOS     #0-0]  ✓ updates the result text when the target is tapped   (1 passing)
```

---

## The trap index

Every entry is a real observed failure, not a hypothetical.

| Symptom | Actual cause | Guard |
| --- | --- | --- |
| `xcodebuild test` prints a suite tree where every line says `passed`, and `Executed 0 tests` | Test host crashed on launch; XCTest restarted it with nothing left to run. No `** TEST FAILED **` is printed, and the word `crash` never appears | [`bin/ios_test_result_check`](bin/ios_test_result_check) — assert the executed count |
| iOS suite green for a month, one test file never ran | The `.swift` file was on disk and reviewed, but absent from the Xcode target in `project.pbxproj` | [docs](docs/false-green-tests.md#before-the-run--assert-on-the-scheme) — assert disk files vs target |
| iOS suite green, zero tests run, scheme looks fine in Xcode | Shared scheme lost its `<TestableReference>`, or has one marked `skipped = "YES"` | [`bin/ios_scheme_check`](bin/ios_scheme_check) — assert the scheme *before* building |
| A scheme check passes on every scheme, including broken ones | Xcode writes attributes on their **own lines**, so `grep 'TestableReference.*skipped'` matches nothing on a real scheme and reports a clean pass on a file it never parsed | track the open tag to its `>`; tolerate `skipped = "YES"` spacing |
| CI boots a different simulator than you named | A prefix match silently selects `iPhone 16 Pro` when you asked for `iPhone 16`, so you test a device you did not choose | [`bin/gha_prepare_ios_simulator`](bin/gha_prepare_ios_simulator) — exact-name match, and it prints what the image ships |
| The first test on a fresh simulator flakes | `simctl boot` returns when the boot *begins*; SpringBoard is still coming up. Looks like a flaky test | wait with `simctl bootstatus -b` |
| A compile error under `src/androidTest/` never fails CI | `:app:assembleDebug` does not compile the `androidTest` source set. "The compile gate is green" ≠ "the tests pass" | [docs](docs/false-green-tests.md#android-the-fourth-mechanism) — run `assembleDebugAndroidTest` *and* `connectedDebugAndroidTest` |
| A test-count parser is correct in dev and wrong in CI | `xcresulttool` summaries are **not flat**: `devicesAndConfigurations[]` repeats the counts per destination. A whole-text scan reads a per-device count as the run total. The first draft was written against an *empty* bundle, where that array is `[]` | parse top-level members only — see the `summary_counts` awk in the script |
| A required gate goes permanently red one day, for no code change | `--schema-version` was pinned; Apple retired that version, and CI's Xcode auto-upgrades | don't pin it — assert on the count **fields** and fail closed |
| A required gate was silently switched off | An `ALLOW_ZERO_TESTS`-style env var set in a workflow step, with nothing detecting it | refuse the escape hatch when `CI` is set |
| `connectedDebugAndroidTest` prints `BUILD SUCCESSFUL` having run nothing | With no tests in the source set it prints **no test line at all** and leaves the results directory **empty**. Verified on a real emulator | [`bin/android_test_result_check`](bin/android_test_result_check) — assert the executed count |
| An Android test-count parser reports 2 tests for a 1-test run | Gradle's JUnit XML nests `<testsuite>` inside `<testsuites>`, **both carrying `tests=`**, and `<testsuite` is a *prefix* of `<testsuites` | read the outer aggregate only, require exactly one per file, sum across files |
| A results parser works locally and finds no files in CI | Real report filenames contain spaces and parentheses — `TEST-Pixel_6(AVD) - 16-_app-.xml`. Anything that word-splits the file list breaks on the first real device | iterate with `while IFS= read -r`, never `$(cat list)` |
| The emulator never finishes booting; the boot timeout expires | The runner user cannot open `/dev/kvm`, so it silently falls back to software rendering. **The symptom looks like a broken AVD** | [emulator action](.github/actions/android-emulator-test/action.yml) — install the KVM udev rule first |
| The emulator dies ~0.4s after launch, then the job burns its whole timeout | `Not enough space to create userdata partition`. `pixel_6` defaults to ~7.4 GB; the runner has a few GB free. The emulator action then polls for a device that will never appear | free disk **before** boot and set `disk-size: 6144M` |
| A faster emulator lane quietly stops testing what it exists for | `google_atd` images disable hardware rendering, so anything that renders (WebView, Compose, custom `View`) becomes structurally uncoverable — while still passing | use `google_apis` for any rendering surface |
| Switching device farms means editing every test | The farm's uploaded-app handle, vendor capability namespace, or device names leaked into specs | [provider boundary](e2e/providers/provider.ts) — three methods; assert it with a grep in CI |
| A device class silently resolves to nothing on one farm | Nothing forced each provider to handle every class | [contract test](e2e/support/provider.contract.test.ts) — assert every class on every platform |
| A CI lint finding nobody can reproduce locally | The linter was installed unpinned (`apt-get install shellcheck`). Versions emit **different check IDs for the same code** — 0.9.0 flags `SC2317` on a trap-invoked function's body where 0.11.0 flags `SC2329` on its declaration — so `# shellcheck disable=` directives stop matching | [`ci.yml`](.github/workflows/ci.yml) — pin the version, **assert the pin took effect**, and lint under every version you claim to support |

| A check script works on your Mac and misbehaves on the runner | Ubuntu's `/usr/bin/awk` is **mawk**, macOS ships BSD awk. mawk's `{n,m}` interval quantifiers cannot be relied on, and the failure can be a silent "matched nothing" | [`ci.yml`](.github/workflows/ci.yml) — run the suites under **both** mawk and gawk, and assert the shim took effect |
| A mid-pipeline failure reads downstream as "found nothing" | POSIX `sh` has no `pipefail`; only the last stage's status survives. Two failed reads both yield `""`, so `"" = ""` reports "same" and the caller acts on a conclusion it never computed | already gated: `shellcheck --shell=sh` reports **SC3040** for `set -o pipefail` in a `sh` script, under both pinned versions |

Full reasoning: **[docs/false-green-tests.md](docs/false-green-tests.md)**.

**Twenty entries, indexed by symptom:** [docs/ci-traps.md](docs/ci-traps.md) — traps where the first
plausible explanation is wrong, across shell portability, git, the Actions platform, builds that exit
0 while lying, and devices. Each is marked **gate** / **measured** / **observed**, so you can tell
what is enforced here from what is reported from a repo you cannot see. (A few of them are the rows
above, in full.)

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

## `bin/ios_scheme_check`

Asserts an Xcode scheme will actually run tests, **before** you pay for a build.

```sh
bin/ios_scheme_check App.xcodeproj/xcshareddata/xcschemes/App.xcscheme
```

Same exit-code contract as the result checks (`0` / `1` gate fired / `2` usage / `3` indeterminate).
It covers the two *static* causes of a zero-test iOS run — no `<TestableReference>`, or every one
`skipped = "YES"` — and keeps them distinguishable, because the remedies differ.

**Use it together with `ios_test_result_check`, not instead of it.** They fail at different times: a
valid scheme proves nothing about runtime, and an executed count cannot tell you the scheme was wrong
before you spent ten minutes finding out.

## `bin/android_test_result_check`

Fails an Android instrumentation run that executed nothing.

```sh
./gradlew :app:connectedDebugAndroidTest
bin/android_test_result_check app/build/outputs/androidTest-results/connected
```

Same exit-code contract as the iOS guard (`0` ran / `1` gate fired / `2` usage / `3` indeterminate,
fails closed), and the same `ALLOW_ZERO_TESTS` escape hatch that is refused under CI.

One asymmetry worth knowing: the real Android false-green — no tests in the source set — leaves the
results directory **empty**, which is indistinguishable from a failed install or a wrong path. So it
lands on `3` (indeterminate) rather than `1`, and the message says which possibilities to check.
Either way the lane goes red; the code tells you whether the tool made a claim about your tests.

## `.github/actions/android-emulator-test`

The emulator lane as a composite action, carrying the tuning that makes it boot at all — each setting
documented with the failure it prevents, and each trade-off with the numbers behind it.

```yaml
- uses: fruitiecutiepie/mobile-ci-kit/.github/actions/android-emulator-test@main
  with:
    working-directory: path/to/your/gradle/project
```

It boots the emulator, runs your Gradle task, **asserts tests actually executed**, and uploads the
reports. This repo's own CI runs it against `examples/minimal-android`, so the action has a green run
behind it rather than a plausible-looking YAML file.

Reasoning, including why the AVD is deliberately **not** cached: **[docs/emulator-in-ci.md](docs/emulator-in-ci.md)**.

## `bin/gha_prepare_emulator_runner` and `bin/gha_prepare_ios_simulator`

The prep each lane needs before it can run, as scripts you can read and copy rather than lines trapped
in one workflow file — one per platform, so neither is the odd one out.

The Android one installs the KVM udev rule and reclaims disk before boot. The iOS one resolves a
device name to a udid by **exact** match, boots it only if it is not already booted (`simctl boot`
errors on a booted device), and waits with `bootstatus -b` because *booted is not ready*. When the
name is wrong it prints what the image actually ships — otherwise an unknown device surfaces as a
`-destination` error, which reads like a malformed destination string.

## `bin/gha_stop_if_superseded` and `bin/gha_cancel_run`

Stop paying for a verdict that is already decided. `gha_stop_if_superseded` fails fast when a newer
commit has landed on the branch; `gha_cancel_run` cancels the run from the job that went red.

Two traps encoded in them, both of which cost real debugging time:

* `gha_stop_if_superseded` fetches with `--depth=1` **only when the repo is already shallow**. On a
  job that paid for `fetch-depth: 0`, an unconditional `--depth=1` writes a new shallow boundary into
  `.git/shallow` and poisons every later history-dependent git command in the same checkout —
  `git log` can report the branch tip as *adding* a file that was added years earlier, and
  `git merge-base` can silently return a wrong answer instead of erroring.
* `gha_cancel_run` only works if your jobs gate on `!cancelled()`. **`if: always()` makes a job
  structurally uncancellable** — it ignores this *and* the manual Cancel button. And the cancel step
  must come after any artifact upload, or you lose the reports explaining the failure that triggered
  it.

---

## `e2e/` — WebdriverIO + Appium, with a thin provider boundary

One spec, selecting only on accessibility ids, driving a real emulator. The point is that it is
**provider-agnostic**: the same spec runs locally or on a device farm, and switching is a config
change plus one provider file, not a migration.

```sh
cd e2e
npm ci
npm run test:contract   # 12 device-free assertions: the provider contract
npm run typecheck
npm run test:android    # needs an emulator; Appium is started/stopped by the run
```

The entire vendor-shaped surface is three methods:

```ts
interface DeviceProvider {
  endpoint(): ProviderEndpoint;
  capabilities(target: DeviceTarget): ProviderCapabilities;
  prepareApp(localPath: string): Promise<AppArtifact>;
}
```

Three anti-goals, each with a reason in [docs/appium-portability.md](docs/appium-portability.md):

* **No wrapper around Appium.** A `MobileDriver` with `click()`/`type()` rebuilds WebDriver behind a
  worse interface. WebDriver semantics are already the portable part.
* **No vendor app identifier above the boundary.** A farm's upload handle never reaches a spec, so
  "switch provider" never means "edit every test".
* **No hard-coded device names.** Selection is semantic (`modern_flagship`, `oldest_supported`) and the
  provider resolves it against real inventory.

**There is deliberately no `browserstack.ts` here.** A stub no test exercises is unverifiable code that
reads like a working integration. What exists instead is checkable: a contract test defining what any
provider must satisfy, plus the farm mappings as worked examples in the docs. CI also greps the specs
for vendor strings and platform branching, so the boundary is asserted rather than trusted.

---

## Tests, and why they are mutation-tested

```sh
tests/ios_scheme_check_test             # 20 assertions, fixtures only
tests/ios_test_result_check_test        # 46 assertions, no Xcode needed
tests/android_test_result_check_test    # 31 assertions, no emulator/SDK/gradle needed
cd e2e && npm run test:contract         # 13 assertions, no Appium/device needed
```

A guard that cannot fail reports success exactly like a working one — which is the bug this repo is
about, one level up. So the suite is checked by mutating the script and confirming it goes red.
Currently caught:

| Guard | Mutation | Caught by |
| --- | --- | --- |
| iOS | drop `expectedFailures` from the executed sum | `a run of only expected failures counts as having run` |
| iOS | stop distinguishing an all-skipped run | `an all-skipped run fails` |
| iOS | let the opt-out suppress an unparseable count | `the opt-out does not suppress an unparseable count` |
| iOS | stop refusing the opt-out under CI | `the opt-out is refused when CI is set` |
| Android | conflate `<testsuite>` with `<testsuites>` (double count) | 17 assertions, incl. `the outer <testsuites> aggregate is read` |
| Android | treat an empty results directory as fine | `an empty results directory is indeterminate, never a pass` |
| Android | count skipped tests as executed | `an all-skipped run fails` |
| Android | stop refusing the opt-out under CI | `the opt-out is refused when CI is set` |
| Scheme | match `skipped` only on the tag's own line (real Xcode format missed) | 5 assertions fail |
| Scheme | treat *any* skipped testable as fatal | `one skipped and one enabled testable still passes` |
| Scheme | conflate no-testable with all-skipped | `the all-skipped failure is distinguished…` |
| Scheme | parse a truncated scheme anyway | `an unterminated testable tag is indeterminate` |
| Appium spec | remove the tap, keeping both assertions | the spec fails on a real emulator (proved, not assumed) |
| Leak check | plant `bs://` in a spec | the grep reports it (control-tested; a check that cannot fail is worthless) |

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

**Just a script.** Every file in `bin/` is standalone — POSIX `sh` and `awk`, no shared library, no
config. Copy the one you need, and copy its suite from `tests/` if you want the assertions to keep
holding.

**Just the action.** `uses: fruitiecutiepie/mobile-ci-kit/.github/actions/android-emulator-test@main`
with a `working-directory`. Nothing else in the kit needs to exist for it. If you only want the
emulator prerequisites and will run your own command, use `android-emulator-setup` instead — both call
one shared `bin/gha_prepare_emulator_runner`, so the tuning cannot drift between them.

**Just the boundary.** Copy `e2e/providers/provider.ts` and the contract test; implement it for
whatever you actually run on.

**Just the reasoning.** `docs/false-green-tests.md` stands alone. If you only change one thing after
reading it, assert an executed count.

The scripts are linted under **shellcheck 0.9.0 and 0.11.0** on every push, because "clean under
shellcheck" is a claim about more than one version and these two disagree about the same code. An
untested compatibility claim is the kind of thing this repo exists to argue against.

---

## Reusable workflows

For adopting a whole lane rather than composing steps yourself:

```yaml
jobs:
  android:
    uses: fruitiecutiepie/mobile-ci-kit/.github/workflows/android-instrumentation.yml@main
    with:
      working-directory: client/android

  ios:
    uses: fruitiecutiepie/mobile-ci-kit/.github/workflows/ios-xctest.yml@main
    with:
      working-directory: client/ios
      project: App.xcodeproj
      scheme: App
      simulator: iPhone 16
```

Both check this kit out into `.mobile-ci-kit/` and call the composite action from there. That is not
incidental: a reusable workflow **cannot** `uses:` a local action from the calling repository, because
the path resolves against the caller's checkout, which does not contain this kit. Prefer the composite
actions directly when you need your own steps interleaved with the run.

## What is verified, and how

Nothing in this README describes a lane without a green CI run behind it. Specifically:

| Claim | How it is verified |
| --- | --- |
| The iOS guard works on a real `.xcresult` | Run against one produced by a real simulator test run, reporting `2 test(s) executed` |
| The Android guard reads the run total, not a per-class copy | Run against a real report; reports `tests=1`, not `2` |
| `connectedDebugAndroidTest` is green with zero tests | Deleted the only test from the source set on a real emulator; `BUILD SUCCESSFUL`, empty results directory |
| The emulator lane works on a GitHub runner | Green CI job; the guard logged `1 test(s) executed` |
| The Appium spec is not vacuous | Removed the tap; the spec fails on a real emulator |
| The same spec runs on both platforms | Passed on an Android emulator and an iOS simulator, spec byte-identical |
| The leak check can detect a leak | Planted `bs://` in a spec; the grep reported it |
| Both guards' suites can fail | Eight mutations, all caught (table above) |
| The awk matrix catches a real divergence | Injected gawk's `gensub()`: mawk leg red, gawk leg green, identical code |
| The awk shim actually takes effect | Requested gawk while shimming mawk; the assertion fired and the step exited 1 |
| `pipefail` in a `sh` script is caught | `SC3040` under shellcheck 0.9.0 **and** 0.11.0 |
| `checkbashisms` would have added nothing | Ten bashism probes: it caught nothing shellcheck missed, and **missed** `set -o pipefail`. Dropped rather than added |
| The scheme fixtures match real Xcode output | Compared against two native sources — an xcodegen-generated scheme and a hand-maintained Xcode one; both use the multi-line `skipped = "NO"` form |
| The simulator prep matches exactly, not by prefix | A prefix-only name is rejected with the available list, rather than booting a near-miss device |

## Roadmap

Everything described above is present and exercised by this repo's own CI. Still to come:

- A device-farm provider, if and when there is an account to verify one against. The contract test and
  the worked mappings in [docs/appium-portability.md](docs/appium-portability.md) are what make that a
  small change rather than a migration — and writing one unverified is exactly what this repo argues
  against.
