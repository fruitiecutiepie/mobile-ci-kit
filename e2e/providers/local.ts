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
    // A local run has exactly one device attached, so every device class resolves to it. That is
    // stated rather than hidden: locally, a device CLASS is not a selector, and pretending otherwise
    // would let a spec claim coverage of `oldest_supported` that the run never had. `deviceName` is
    // required by Appium but ignored for selection when only one device is present.
    const shared = {
      "appium:deviceName": `local-${target.deviceClass}`,
      "appium:newCommandTimeout": 180,
      // Keep the app installed between sessions where possible: reinstalling per test is the single
      // biggest avoidable cost in a local Appium loop.
      "appium:noReset": false,
    };

    if (target.platform === "android") {
      return {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        // Espresso's ~30s default is too tight for a cold CI emulator.
        "appium:uiautomator2ServerLaunchTimeout": 120_000,
        "appium:adbExecTimeout": 120_000,
        ...shared,
      };
    }

    return {
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      // Simulators need no code signing, which is what makes an iOS lane free and CI-viable.
      "appium:simulatorStartupTimeout": 300_000,
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
