import { strict as assert } from "node:assert";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { DEVICE_CLASSES, type DeviceProvider, type DeviceTarget } from "../providers/provider.ts";
import { LocalProvider } from "../providers/local.ts";
import { resolveProvider } from "../providers/index.ts";

/**
 * The provider contract, as an executable test.
 *
 * This file is the reason there is no stub `browserstack.ts` in this repo. A stub would be
 * unverifiable code that reads like a working integration; this is a checkable definition of what
 * any provider must do, which a farm implementation can be run against on the day it is written.
 *
 * Everything here is device-free and runs in milliseconds -- no Appium, no emulator, no network.
 */
function contractFor(makeProvider: () => DeviceProvider): void {
  const provider = makeProvider();

  it("has a non-empty name", () => {
    assert.ok(provider.name.length > 0, "a provider must identify itself for logs and selection");
  });

  it("returns a usable endpoint", () => {
    const endpoint = provider.endpoint();
    assert.ok(["http", "https"].includes(endpoint.protocol));
    assert.ok(endpoint.hostname.length > 0);
    assert.ok(Number.isInteger(endpoint.port) && endpoint.port > 0 && endpoint.port < 65_536);
    assert.ok(endpoint.path.startsWith("/"), "path must be absolute so URL joining is unambiguous");
  });

  it("handles every device class on every platform", () => {
    // The load-bearing case. Adding a DeviceClass to the union forces every provider to answer for
    // it, instead of a class silently resolving to undefined on one farm and being noticed months
    // later by a spec that claimed coverage it never had.
    for (const platform of ["android", "ios"] as const) {
      for (const deviceClass of DEVICE_CLASSES) {
        const caps = provider.capabilities({ platform, deviceClass });
        assert.ok(
          typeof caps.platformName === "string" && caps.platformName.length > 0,
          `no platformName for ${platform}/${deviceClass}`,
        );
      }
    }
  });

  it("reports platformName consistent with the requested platform", () => {
    const android = provider.capabilities({ platform: "android", deviceClass: "modern_phone" });
    const ios = provider.capabilities({ platform: "ios", deviceClass: "modern_phone" });
    assert.equal(String(android.platformName).toLowerCase(), "android");
    assert.equal(String(ios.platformName).toLowerCase(), "ios");
  });

  it("names an automation driver, since Appium 2+ will not guess one", () => {
    for (const platform of ["android", "ios"] as const) {
      const caps = provider.capabilities({ platform, deviceClass: "modern_phone" });
      assert.ok(
        typeof caps["appium:automationName"] === "string",
        `no appium:automationName for ${platform}`,
      );
    }
  });

  it("is pure: the same target twice gives an equivalent object", () => {
    const target: DeviceTarget = { platform: "android", deviceClass: "modern_flagship" };
    const first = provider.capabilities(target);
    const second = provider.capabilities(target);
    assert.deepEqual(first, second);
    assert.notEqual(first, second, "returning the same mutable object lets one caller affect another");
  });

  it("rejects an app artifact that does not exist", async () => {
    // Fail closed. A provider that resolves a path it never checked turns a missing build into an
    // obscure Appium session error much later, naming the session rather than the build.
    await assert.rejects(
      () => provider.prepareApp(join(tmpdir(), "definitely-not-here-9f3a1c.apk")),
      /not readable|not found|no such file/i,
    );
  });

  it("returns something usable as appium:app for an artifact that does exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "provider-contract-"));
    const app = join(dir, "fixture.apk");
    await writeFile(app, "not a real apk");
    const artifact = await provider.prepareApp(app);
    assert.ok(
      typeof artifact.appiumApp === "string" && artifact.appiumApp.length > 0,
      "appiumApp must be a non-empty string",
    );
  });
}

describe("DeviceProvider contract: local", () => {
  contractFor(() => new LocalProvider());
});

describe("provider resolution", () => {
  it("resolves the local provider by name", () => {
    assert.equal(resolveProvider("local").name, "local");
  });

  it("throws on an unknown provider rather than falling back to local", () => {
    // Falling back would make a typo in DEVICE_PROVIDER run the whole suite against the wrong
    // target and report success -- the same fail-open shape as a gate that passes having tested
    // nothing.
    assert.throws(() => resolveProvider("browserstack"), /unknown DEVICE_PROVIDER/);
  });
});

describe("local provider specifics", () => {
  it("returns an absolute path for appium:app", async () => {
    const dir = await mkdtemp(join(tmpdir(), "provider-local-"));
    const app = join(dir, "fixture.apk");
    await writeFile(app, "not a real apk");
    const artifact = await new LocalProvider().prepareApp(app);
    assert.ok(artifact.appiumApp.startsWith("/"), "Appium needs an absolute path for a local app");
  });

  it("carries no vendor-specific capability namespaces", () => {
    // `bstack:options`, `sauce:options` and friends belong to a farm provider. If one appears here,
    // vendor configuration has leaked to the wrong side of the boundary.
    const caps = new LocalProvider().capabilities({
      platform: "android",
      deviceClass: "modern_phone",
    });
    for (const key of Object.keys(caps)) {
      assert.ok(
        !/^[a-z]+:options$/.test(key) || key.startsWith("appium:"),
        `unexpected vendor namespace in local capabilities: ${key}`,
      );
    }
  });
});
