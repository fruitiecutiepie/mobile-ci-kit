import { expect } from "@wdio/globals";

import { mainScreen } from "../screens/main.screen.ts";

/**
 * The cross-platform spec.
 *
 * There is deliberately NO reference to a platform, a provider, a device name, or an uploaded-app
 * identifier anywhere in this file. It is the artifact the whole provider boundary exists to make
 * possible: this same spec runs against a local Android emulator, a local iOS simulator, or a device
 * farm, unchanged.
 *
 * If a change to this file ever needs `if (driver.isAndroid)`, that is the signal that something
 * platform-specific leaked out of the app's accessibility ids and into the test.
 */
describe("the fixture app", () => {
  it("updates the result text when the target is tapped", async () => {
    await mainScreen.waitUntilReady();

    // Asserted BEFORE the tap as well as after. Without the pre-state assertion, a screen that
    // happened to already read "tapped" -- a stale session, a reused app state -- would pass this
    // test without the tap doing anything.
    await expect(mainScreen.resultText).toHaveText("not tapped");

    await mainScreen.tapTarget.click();

    await expect(mainScreen.resultText).toHaveText("tapped");
  });
});
