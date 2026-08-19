/**
 * Screen object for the fixture app's only screen.
 *
 * Selectors are accessibility ids (`~name`) exclusively. That is the whole portability argument in
 * one line: `~tap-target` resolves via `contentDescription` on Android and `accessibilityIdentifier`
 * on iOS, so this file has no platform branching and neither does any spec that uses it.
 *
 * What NOT to use, and why:
 *   - XPath (`//XCUIElementTypeButton[2]`) -- platform-specific by construction, and brittle against
 *     any layout change.
 *   - Visible text -- translated, restyled, and a copy change becomes a test failure.
 *   - Android view ids -- not addressable by Appium at all.
 */
class MainScreen {
  get tapTarget() {
    return $("~tap-target");
  }

  get resultText() {
    return $("~result-text");
  }

  async waitUntilReady(): Promise<void> {
    await this.tapTarget.waitForDisplayed({ timeout: 30_000 });
  }
}

export const mainScreen = new MainScreen();
