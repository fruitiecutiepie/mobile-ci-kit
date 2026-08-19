import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import type {
  AppArtifact,
  DeviceProvider,
  DeviceTarget,
  ProviderCapabilities,
  ProviderEndpoint,
} from "./provider.ts";

/**
 * The local provider: an Appium server on this machine, driving an attached emulator or simulator.
 *
 * This is the only provider implemented in this repo, on purpose. A stub `browserstack.ts` that no
 * test exercises is unverifiable code that reads as a working integration -- see
 * docs/appium-portability.md, which instead gives the farm mappings as worked examples plus a
 * contract any real implementation must satisfy.
 */
export class LocalProvider implements DeviceProvider {
  readonly name = "local";

  endpoint(): ProviderEndpoint {
    return {
      protocol: "http",
      hostname: process.env.APPIUM_HOST ?? "127.0.0.1",
      port: Number(process.env.APPIUM_PORT ?? 4723),
      path: "/",
    };
  }

  capabilities(target: DeviceTarget): ProviderCapabilities {
    // Locally there is one device attached, so a device CLASS cannot be honoured as a selector. That
    // is stated rather than hidden: pretending otherwise would let a spec claim coverage of
    // `oldest_supported` that the run never had.
    const shared = {
      "appium:newCommandTimeout": 180,
      "appium:noReset": false,
    };

    if (target.platform === "android") {
      return {
        // UiAutomator2 ignores `deviceName` for selection when exactly one device is attached, so a
        // descriptive value is harmless and shows up usefully in logs.
        "appium:deviceName": `local-${target.deviceClass}`,
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        // The ~30s default is too tight for a cold CI emulator.
        "appium:uiautomator2ServerLaunchTimeout": 120_000,
        "appium:adbExecTimeout": 120_000,
        ...shared,
      };
    }

    // A PLATFORM ASYMMETRY worth knowing, and the reason this lives in the provider rather than in a
    // spec: on iOS, `appium:deviceName` is NOT ignored. XCUITest treats it as a simulator DEVICE TYPE
    // and tries to create a simulator from it, so a descriptive value fails the session outright with
    // "Could not create simulator with name '...', device type id 'local-modern_phone'". It has to be
    // a device type that actually exists.
    //
    // So locally, iOS needs a real simulator name -- which is exactly the kind of thing the provider
    // boundary exists to absorb. The specs stay identical across platforms; this file carries the
    // difference.
    return {
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      // A concrete simulator, overridable per machine and per CI runner image. There is no safe
      // semantic default here: an image ships whichever simulators it ships.
      "appium:deviceName": process.env.IOS_SIMULATOR_NAME ?? "iPhone 17",
      // A udid pins an ALREADY-BOOTED simulator, which is both faster and more deterministic than
      // letting Appium pick or create one. Omitted rather than set empty, so Appium falls back to
      // deviceName cleanly.
      ...(process.env.IOS_SIMULATOR_UDID ? { "appium:udid": process.env.IOS_SIMULATOR_UDID } : {}),
      ...(process.env.IOS_PLATFORM_VERSION
        ? { "appium:platformVersion": process.env.IOS_PLATFORM_VERSION }
        : {}),
      // Simulators need no code signing, which is what makes an iOS lane free and CI-viable with no
      // Apple Developer account.
      "appium:simulatorStartupTimeout": 300_000,
      // WDA's FIRST build on a machine dominates the first session and takes several minutes. With a
      // short timeout the failure reads "Request timed out!" and names neither WebDriverAgent nor the
      // build -- observed as a 9-minute session failure that looked like a broken Appium install.
      // These are generous on purpose and cost nothing once WDA is installed.
      "appium:wdaLaunchTimeout": 600_000,
      "appium:wdaConnectionTimeout": 600_000,
      "appium:wdaStartupRetries": 2,
      "appium:wdaStartupRetryInterval": 20_000,
      ...shared,
    };
  }

  async prepareApp(localPath: string): Promise<AppArtifact> {
    const absolute = isAbsolute(localPath) ? localPath : resolve(process.cwd(), localPath);
    try {
      await access(absolute, constants.R_OK);
    } catch {
      // Fail here, loudly, rather than handing Appium a path that does not exist. Appium's own error
      // for a missing app arrives much later and names the session, not the build.
      throw new Error(
        `local provider: app artifact not readable at ${absolute}. ` +
          `Build it first (e.g. ./gradlew :app:assembleDebug) or pass APP_PATH.`,
      );
    }
    return { appiumApp: absolute };
  }
}
