# Writing a mobile E2E suite that a device farm cannot hold hostage

The decision that determines whether you can move between local devices and a device farm — or
between farms — is **not which farm you pick**. It is the test framework, and where you draw the
boundary around vendor configuration.

WebdriverIO + Appium is the portable choice because Appium's architecture already assumes the server
may be remote: your client speaks a standardised protocol to an Appium server, and a cloud provider is
just someone else hosting that server. Test code, selectors, waits, and screen objects transfer
unchanged. What does not transfer is auth, app upload, and device selection — and that is a small,
nameable surface.

So the rule this repo follows:

> **Tests speak Appium. Only a provider speaks vendor.**

## The boundary, in full

Three methods. That is the entire surface that differs between local and any farm
([`e2e/providers/provider.ts`](../e2e/providers/provider.ts)):

```ts
interface DeviceProvider {
  endpoint(): ProviderEndpoint;
  capabilities(target: DeviceTarget): ProviderCapabilities;
  prepareApp(localPath: string): Promise<AppArtifact>;
}
```

Everything else is Appium, and Appium is the same everywhere.

## Three anti-goals, with reasons

### 1. Do not abstract Appium

The tempting move is a `MobileDriver` interface with `click()`, `type()`, `swipe()`. Don't. That is
rebuilding WebDriver behind a smaller, worse interface, and it buys nothing — WebDriver semantics are
*already* the portable part. Specs use WebdriverIO directly:

```ts
await $("~tap-target").click();
await expect($("~result-text")).toHaveText("tapped");
```

Those calls work identically on a local emulator and on any farm. An abstraction over them adds a
layer to maintain and removes nothing you were going to have to change.

### 2. Do not let a provider's app identifier reach a test

A farm's upload API returns an opaque handle. That handle must never appear in a spec, a screen
object, or a workflow — otherwise "switch provider" becomes "edit every test". `prepareApp` returns
an `AppArtifact` whose `appiumApp` goes into `appium:app`, and the local provider returns a filesystem
path while a farm provider returns its handle. Neither is visible above the boundary.

### 3. Do not hard-code vendor device names

`Samsung Galaxy S24-14.0` in fifteen workflows couples you to one farm's current inventory. Fleets get
refreshed, OS versions retired, and two vendors name the same phone differently. Select **semantically**
and let the provider resolve it:

```ts
type DeviceClass = "modern_flagship" | "modern_phone" | "older_supported" | "oldest_supported";
```

The contract test asserts every provider handles **every** class, so adding one forces each provider to
answer for it instead of silently resolving to `undefined` on one farm.

## Why there is no `browserstack.ts` in this repo

Because it would be unverifiable code that reads like a working integration. Nothing would exercise
it, no CI run would cover it, and it would rot into a confident-looking lie — the exact failure mode
the rest of this repo argues against.

Instead there are two things that *are* checkable:

1. **A contract test** ([`e2e/support/provider.contract.test.ts`](../e2e/support/provider.contract.test.ts))
   — 12 device-free assertions defining what any provider must do. Run a real farm provider against it
   the day you write one.
2. **The mappings below**, as worked examples. They are documentation, and labelled as such.

### What a farm provider fills in

`endpoint()` — the farm's Appium hub, with credentials:

```ts
// BrowserStack App Automate, illustrative:
{ protocol: "https", hostname: "hub.browserstack.com", port: 443, path: "/wd/hub" }
```

`capabilities()` — the same Appium capabilities, plus one vendor namespace:

```ts
// Illustrative only -- check the vendor's current docs for names and required fields.
{
  platformName: "iOS",
  "appium:automationName": "XCUITest",
  "appium:deviceName": "iPhone 15",      // resolved from DeviceClass by the provider
  "appium:platformVersion": "17",
  "bstack:options": { projectName: "...", buildName: buildId, userName: "...", accessKey: "..." },
}
```

`prepareApp()` — upload, then return the handle:

```ts
// POST the binary to the farm's upload endpoint, then:
return { appiumApp: "bs://<returned-id>" };
```

Also drop the `appium` service from the WDIO config when pointing at a farm — the farm runs the
server. [`e2e/wdio.conf.ts`](../e2e/wdio.conf.ts) keys that off `provider.name` rather than hardcoding
it, so it is already handled.

### Do not adopt a vendor SDK in anticipation

A farm's SDK is convenient and is *precisely* the vendor integration layer. Keep the suite on standard
Appium until you need a farm-specific feature; the standard integration already moves mostly through
configuration.

## The thing that matters more than the boundary

**Stable accessibility ids.** They do more for portability *and* for flakiness than any abstraction.

```xml
<!-- Android -->
<Button android:contentDescription="tap-target" ... />
```
```swift
// iOS
button.accessibilityIdentifier = "tap-target"
```

Both surface to Appium as `~tap-target`, so one spec selects on them with **no platform branching**.
Compare the alternatives:

| Selector | Problem |
| --- | --- |
| `//XCUIElementTypeOther[3]/XCUIElementTypeButton[2]` | platform-specific by construction, and brittle against any layout change |
| visible text | translated and restyled; a copy change becomes a test failure |
| Android view id | not addressable by Appium at all |

Pick ids that are **semantic** (`tap-target`), not visual (`blue-button`), and not the visible label.
[`examples/minimal-android`](../examples/minimal-android) models this, and its Espresso test selects by
`contentDescription` rather than view id on purpose — so a rename that would break the Appium specs
breaks the cheap lane first.

CI asserts the boundary holds rather than trusting it: a step greps the specs and screen objects for
vendor strings and platform branching. It excludes comment lines, because this repo's own spec
*discusses* `driver.isAndroid` as a red flag — and that sentence tripped the check on its first run.
The filter is a heuristic, not a TypeScript parse; a `platformName` inside a multi-line string would
slip through. It is a nudge, not a proof.
