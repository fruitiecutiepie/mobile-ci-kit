/**
 * The provider boundary: the ONLY thing that differs between running Appium locally and running it
 * on a device farm.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, because it is the most common way a suite becomes
 * unportable-in-a-different-way: it does not wrap Appium. There is no `MobileDriver` with
 * `click()`/`type()`/`swipe()` methods here. That would be rebuilding WebDriver behind a smaller,
 * worse interface, and it buys nothing -- WebDriver semantics are already the portable part. Specs
 * use WebdriverIO directly (`await $('~tap-target').click()`), and those calls transfer to any
 * provider unchanged.
 *
 * What genuinely varies between providers is narrow, and it is exactly these three things:
 *   - the endpoint the Appium client connects to;
 *   - the capabilities that select a device;
 *   - how the app under test gets to wherever the tests will run.
 *
 * Everything else is Appium, and Appium is the same everywhere.
 */

/** Platforms a target can name. */
export type Platform = "android" | "ios";

/**
 * Device selection is SEMANTIC, not a vendor device name.
 *
 * The alternative -- putting `Samsung Galaxy S24-14.0` in specs and workflows -- couples every
 * caller to one farm's current inventory. Device fleets get refreshed, OS versions get retired, and
 * vendors name the same phone differently. A provider maps a class to whatever it actually has.
 */
export type DeviceClass =
  | "modern_flagship"
  | "modern_phone"
  | "older_supported"
  | "oldest_supported";

/** Every class, so a provider can be checked for handling all of them. */
export const DEVICE_CLASSES: readonly DeviceClass[] = [
  "modern_flagship",
  "modern_phone",
  "older_supported",
  "oldest_supported",
] as const;

export type DeviceTarget = {
  readonly platform: Platform;
  readonly deviceClass: DeviceClass;
};

/**
 * Where the app under test lives, from Appium's point of view.
 *
 * A local provider returns an absolute filesystem path. A farm provider returns whatever opaque
 * identifier that farm's upload API handed back. The distinction is the provider's business, and
 * `appiumApp` is what goes into `appium:app` either way -- so no provider-specific identifier ever
 * needs to appear in a spec, a screen object, or a workflow.
 */
export type AppArtifact = {
  readonly appiumApp: string;
};

/** The Appium server a provider talks to, in the shape WebdriverIO's config wants. */
export type ProviderEndpoint = {
  readonly protocol: "http" | "https";
  readonly hostname: string;
  readonly port: number;
  readonly path: string;
};

/** Capabilities are passed straight to Appium; the type is intentionally open. */
export type ProviderCapabilities = Record<string, unknown>;

export interface DeviceProvider {
  /** Stable identifier, used in logs and to select the provider. */
  readonly name: string;

  /** Where the Appium client connects. */
  endpoint(): ProviderEndpoint;

  /**
   * Capabilities for one target. Must be pure: called more than once for the same target it returns
   * an equivalent object, and it never mutates shared state.
   */
  capabilities(target: DeviceTarget): ProviderCapabilities;

  /**
   * Make `localPath` reachable by the Appium server and return what to put in `appium:app`.
   *
   * Must reject rather than resolve when the artifact does not exist. A provider that returns a
   * path it never checked turns a missing build into an obscure Appium session error much later,
   * which is the same fail-open shape this repo argues against everywhere else.
   */
  prepareApp(localPath: string): Promise<AppArtifact>;
}
