import { resolveProvider } from "./providers/index.ts";
import type { DeviceTarget, Platform } from "./providers/provider.ts";

/**
 * WebdriverIO config -- the ONLY file that knows a provider exists.
 *
 * Specs and screen objects speak Appium and nothing else. Everything vendor-shaped (endpoint,
 * capabilities, app upload) is resolved here, through the provider, so switching to a device farm is
 * a change to `DEVICE_PROVIDER` plus one new provider file -- not a migration of the suite.
 */
const provider = resolveProvider();
const endpoint = provider.endpoint();

const platform = (process.env.TARGET_PLATFORM ?? "android") as Platform;
if (platform !== "android" && platform !== "ios") {
  throw new Error(`TARGET_PLATFORM must be "android" or "ios", got: ${platform}`);
}

const target: DeviceTarget = {
  platform,
  deviceClass: "modern_phone",
};

const defaultApp =
  platform === "android"
    ? "../examples/minimal-android/app/build/outputs/apk/debug/app-debug.apk"
    : "../examples/minimal-ios/build/Debug-iphonesimulator/Minimal.app";

// Awaited at module scope: the config must fail loudly HERE if the app is missing, rather than let
// every spec fail later with an Appium session error that names the session and not the build.
const artifact = await provider.prepareApp(process.env.APP_PATH ?? defaultApp);

export const config: WebdriverIO.Config = {
  runner: "local",
  protocol: endpoint.protocol,
  hostname: endpoint.hostname,
  port: endpoint.port,
  path: endpoint.path,

  specs: ["./specs/**/*.spec.ts"],
  maxInstances: 1,

  capabilities: [
    {
      ...provider.capabilities(target),
      "appium:app": artifact.appiumApp,
    },
  ],

  logLevel: "warn",
  waitforTimeout: 20_000,
  connectionRetryTimeout: 180_000,
  connectionRetryCount: 2,

  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 180_000,
  },

  // Starts and stops Appium around the run, so no separate `appium &` step is needed and no orphan
  // server survives a failed run. Local only: a farm provides its own endpoint, and this service
  // must be absent when pointing at one -- hence keying it off the provider rather than hardcoding.
  //
  // Written as a tuple rather than a top-level `appium:` key: the tuple is what the service's own
  // types describe, so the options are typechecked instead of silently ignored.
  services: provider.name === "local"
    ? [
        [
          "appium",
          {
            args: {
              address: endpoint.hostname,
              port: endpoint.port,
              relaxedSecurity: true,
            },
          },
        ],
      ]
    : [],
};
