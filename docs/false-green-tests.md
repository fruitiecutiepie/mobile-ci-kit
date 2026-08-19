# Four ways a mobile test suite passes having tested nothing

A failing test is a good outcome: something told you. The dangerous state is a gate that reports
success while executing zero tests, because it is indistinguishable from a gate that is working —
and unlike a flaky test, nobody investigates a green run.

All four mechanisms below were found in one production repo over about two months. Each looked green.
One kept a whole Swift test file out of the build for a month without a single red run.

The theme: **a passing exit code is not evidence that anything ran.** On both platforms, the only
trustworthy signal is a count of tests actually executed, asserted separately from the tool's own
verdict.

---

## iOS: three mechanisms, needing two different guards

`xcodebuild test` reports success with zero tests, so nothing downstream objects. The three
mechanisms need two guards because they happen at different *times*.

### Before the run — assert on the scheme

Both of these are visible in the `.xcscheme` without launching anything:

1. **The shared scheme loses its `<TestableReference>`.** Causes: un-sharing the scheme in Xcode,
   project regeneration, or a bad merge in `project.pbxproj`. The test target still exists and still
   compiles; it is simply no longer part of what `xcodebuild test` runs.
2. **A `<TestableReference>` is present but marked `skipped = "YES"`.**

Assert the scheme *before* `xcodebuild` runs. Both are static facts; there is no reason to pay for a
build to discover them.

A related trap on the same theme, which no scheme check catches: **a source file absent from the
Xcode target is not compiled and not run.** In the repo these notes come from, a Swift test file sat
in the directory, passed code review, and was never in `project.pbxproj` — every gate stayed green
for a month. If your project file is hand-maintained, assert that the files on disk are the files in
the target.

### After the run — assert the executed count

The scheme can be perfectly valid and the run still execute nothing:

3. **The test host crashes on launch.** XCTest restarts it, finds nothing left to run, and prints a
   suite tree where every line says `passed`, ending in `Executed 0 tests, with 0 failures`.

   Observed for real: an `Info-Debug.plist` was missing `NSCameraUsageDescription`, so iOS killed
   the app the instant it touched the camera. A device probe ran zero tests across three launches
   and looked green. A human grepping the log for expected evidence lines caught it; no gate did.

   Two smaller variants land in the same place: an `-only-testing:` identifier that matched no test
   (a typo in an ad-hoc run), and a suite that skipped *every* test — `totalTestCount` includes
   skipped tests, so counting it alone calls that a pass.

Pass `-resultBundlePath` and assert a non-zero executed count. `bin/ios_test_result_check` in this
repo does exactly that, and nothing else.

### Three traps in reading that verdict

Each of these has misled someone:

* **`** TEST SUCCEEDED **` / `** TEST FAILED **` may not be printed at all** in the crash-restart
  state. A grep keying on those tokens inherits the blind spot instead of closing it.
* **The word `crash` never appears.** The only hint is an informational `Restarting after unexpected
  exit, crash, or test timeout` — easy to read past, and absent from a clean run that simply matched
  no tests, so it is not a sufficient signal on its own either.
* **The stdout totals are cumulative across relaunches** ("summary will include totals from previous
  launches"). A run where some tests pass and a *later* crash restarts the host prints a **non-zero**
  count and has still lost work. An executed-count assertion catches total-zero only. **Partial loss
  remains uncovered** — if you care that a specific test ran, grep the log for its own evidence.

### Two traps in the summary the count comes from

Both cost a rewrite:

* **`xcresulttool get test-results summary` is not flat.** `devicesAndConfigurations[]` repeats
  `passedTests` / `failedTests` / `skippedTests` / `expectedFailures` **per destination**. A
  whole-text scan double-counts on one destination and reads a per-device count as the run total on
  two. Only `totalTestCount` happens to be top-level-only, and relying on that is relying on a
  coincidence. Parse top-level members only.

  This bug shipped past review because the first draft was written against an *empty* result bundle,
  where `devicesAndConfigurations` is `[]`. It looked correct until the first real run.

* **Do not pin `--schema-version`.** It reads like a safety measure and is a cliff: `xcresulttool`
  errors on a version it no longer offers, CI on `macos-latest` auto-upgrades Xcode, and a required
  gate's failure is not bypassable — so the day Apple retires the pinned version, the gate goes
  permanently red and the rational response is to delete it. The count **fields** are the real
  contract. Assert that each appears exactly once and fail closed if not.

---

## Android: the fourth mechanism

4. **`:app:assembleDebug` does not compile the `androidTest` source set.**

A syntax or compile error under `src/androidTest/` is invisible to a normal app build — nothing in it
triggers a compile of that source set. In the repo these notes come from, no CI job executed
`androidTest/` at all, and none of it was noticed because everything was green.

Two distinct gates, and they make different claims:

| Gradle task | Claim |
| --- | --- |
| `:app:assembleDebugAndroidTest` | the instrumentation tests **compile** |
| `:app:connectedDebugAndroidTest` | the instrumentation tests **pass** |

"The compile gate is green" is not the same claim as "the tests pass." When you touch anything under
`androidTest/`, name which of the two you actually ran.

---

## The general discipline

1. **Assert an executed count**, separately from the tool's exit code, for every suite you rely on.
2. **Fail closed on unreadable results.** "I could not read the result" must be a *distinct* outcome
   from "I read it and nothing ran" — collapsing them means a schema change is later mistaken for a
   crashed test host, and someone spends a day on the wrong bug. `bin/ios_test_result_check` uses
   exit 3 for indeterminate and exit 1 for the gate firing, deliberately.
3. **Make the escape hatch inoperable in CI.** An `ALLOW_ZERO_TESTS`-style flag is genuinely useful
   locally. If a workflow step can set it, a required gate can be switched off in one line of YAML
   with nothing detecting that it was. Refuse it when `CI` is set.
4. **Prove the guard can fail before you trust it.** A guard that cannot fail reports success
   exactly like a working one — which is the bug this whole page is about, one level up. The suite in
   `tests/` is mutation-tested for this reason; see the README.
