# Running an Android emulator in CI, with the numbers

Getting an emulator to boot on a standard GitHub-hosted runner is mostly a sequence of four
settings, each of which prevents a failure that looks like something else. The interesting part is
not the settings — it is that every one of them is a *measured* trade-off rather than a default
someone copied.

`.github/actions/android-emulator-test/` is this page as code.

## The four settings that decide whether it boots at all

### 1. KVM permissions

Hardware-accelerated virtualisation **is** available on standard 2-vCPU GitHub-hosted Linux runners,
but the runner user cannot open `/dev/kvm` until you install a udev rule:

```bash
printf '%s\n' 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' \
  | sudo tee /etc/udev/rules.d/99-kvm4all.rules
sudo udevadm control --reload-rules
sudo udevadm trigger --name-match=kvm
```

Without it the emulator silently falls back to software rendering and effectively never finishes
booting. **The symptom is the boot timeout expiring**, which reads like a broken AVD or a bad system
image — not like a permissions problem. That misdirection is the whole reason this is step one.

### 2. Disk, before the boot

A runner has only a few GB free once the SDK, a system image, `node_modules` and Gradle caches are in
place. The emulator needs a multi-GB userdata partition, and if it cannot get one it dies
**instantly** with `Not enough space to create userdata partition` — then the emulator action burns
its *entire* boot timeout polling for a device that will never appear. A 45-minute job spends 45
minutes failing for a reason it printed in the first second.

Reclaim toolchains the lane does not use, and deliberately leave the Android SDK and JDK alone:

```bash
sudo rm -rf /usr/share/dotnet /usr/share/swift /usr/local/share/powershell \
            /usr/local/lib/heroku /opt/ghc /opt/hostedtoolcache/CodeQL /opt/google/chrome
```

Print `df -h` before and after. When this eventually stops being enough, you want the number in the
log rather than a rerun.

### 3. `disk-size`, because the profile default is too big

`pixel_6` defaults to roughly a **7.4 GB** userdata partition, which overruns the runner disk and
kills the emulator about **0.4 seconds** after launch. `6144M` boots API 36 with room for two APKs.

This is the same failure as (2), reached from the other direction — and worth stating separately,
because freeing disk space does not help if the profile then asks for more than exists.

### 4. `google_apis`, not `google_atd`

ATD (automated test device) images are meaningfully faster and are the obvious optimisation. They
also **disable hardware rendering**. If anything in your test surface renders — a WebView, a Compose
surface, a custom `View` — an ATD image makes the lane *structurally unable* to cover it, while still
passing.

That is the expensive kind of wrong: a faster lane that has quietly stopped testing the thing it
exists for. Use `google_atd` only for tests that touch no rendering, and say so where you choose it.

## The trade-off worth copying: do not cache the AVD

Caching the AVD is the standard advice and it was **measured and rejected**. The numbers, from a real
repository:

| Fact | Value |
| --- | --- |
| AVD cache entry size | ~2.1 GB |
| GitHub cache limit per repository | 10 GB |
| Repository's existing cache usage | already over the limit, at ~11.3 GB |
| Gradle caches that amortise across every job | ~1.3 GB |
| Time saved by an AVD cache | ~3 min, and **only** on a second push to the same PR |
| Time to create the AVD fresh | ~2m45s |

Two things make it a bad trade there, and both are easy to miss:

* **PR-scoped caches.** GitHub scopes caches by branch. A workflow that only runs on `pull_request`
  writes a cache no *other* PR can read, and `main` never populates one. So the 2.1 GB is paid per
  Android PR and read by almost nobody.
* **Eviction of caches that do work.** Filling the limit with AVD entries evicts the ~1.3 GB of
  Gradle caches that speed up *every* job on *every* PR, to save 3 minutes on some second pushes.

**To revisit it properly**, give the default branch its own warm-up run first, so one shared entry
serves every PR. Then the arithmetic changes and caching may well win. The point is not "never cache
an AVD" — it is that the answer depends on numbers you can measure in an afternoon.

## Order the jobs so the emulator never boots for a decided verdict

The emulator lane is usually the most expensive thing in a mobile pipeline, and it starts *late*.
Measured on one real run: a cheap check failed **9 seconds** in, while the macOS job (10× billing)
still started 6m27s later and the emulator job (45-minute timeout) 9m08s later. Both ran to
completion for a verdict that was already red.

Two complementary mechanisms:

1. **List the cheap jobs in `needs:`** even when the emulator job does not consume their output. They
   finish long before the emulator would start, so it costs no wall-clock, and it stops the boot
   entirely when one of them is red.
2. **Cancel the run from the failing job** — see `bin/gha_cancel_run`. Two things make or break that:
   your jobs must gate on `!cancelled()` rather than `if: always()` (an `always()` job is
   structurally uncancellable and ignores both this and the manual Cancel button), and the cancel
   step must come *after* any artifact upload, or you lose the reports that explain the failure.

Use both. The `needs:` gate holds even when the cancel API call fails.

## Then assert that tests actually ran

`./gradlew :app:connectedDebugAndroidTest` prints `BUILD SUCCESSFUL` and exits **0** when there are
no tests to run. Not "0 tests passed" — no test line at all, and the results directory is left
**empty**.

Verified on a real emulator: deleting the only instrumentation test from the source set turned a
passing lane into a green lane that verified nothing, with no signal anywhere in the output.

So the lane ends with `bin/android_test_result_check`, which reads the JUnit XML and asserts a
non-zero executed count. One parsing trap in it is worth knowing if you write your own:

```xml
<testsuites tests="1" ...>          <!-- the run total for this file -->
  <testsuite name="…Test" tests="1" ...>   <!-- one per class -->
```

Both elements carry `tests=`, and `<testsuite` is a **prefix** of `<testsuites`, so a substring match
double-counts a one-test run and `grep -o '<testsuite'` finds two elements where there is one class.
Read the outer aggregate only, require exactly one per file, and sum across files — real reports are
one file per device, named things like `TEST-Pixel_6(AVD) - 16-_app-.xml`. **That filename contains
spaces and parentheses**, so any construction that word-splits the file list breaks on the first real
device. It broke exactly that way while this was being written.

See [docs/false-green-tests.md](false-green-tests.md) for the iOS half and the general discipline.
