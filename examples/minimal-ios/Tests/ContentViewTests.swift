import XCTest

@testable import Minimal

/// Unit tests, not UI tests, on purpose.
///
/// This lane exists to exercise `bin/ios_test_result_check` against a real `.xcresult`, so the
/// cheapest tests that genuinely run are the right ones. The UI behaviour is covered by the Appium
/// spec, which drives this app through the same accessibility ids as the Android lane.
///
/// Note what these tests deliberately are NOT: `XCTAssertTrue(true)`. A test that cannot fail makes
/// the lane green while proving nothing about the app or the guard, which is the exact bug this
/// repository is about. Each assertion below fails if the thing it names changes.
final class ContentViewTests: XCTestCase {

    /// The cross-platform selector contract. If someone renames an identifier, this fails here --
    /// in the cheap lane -- instead of surfacing as an Appium timeout on one platform only.
    func testAccessibilityIdentifiersMatchTheAndroidFixture() {
        XCTAssertEqual(A11y.tapTarget, "tap-target")
        XCTAssertEqual(A11y.resultText, "result-text")
    }

    /// Both label states, because asserting only the tapped one would pass for a view that is
    /// always "tapped" -- and the Appium spec asserts the pre-tap state for the same reason.
    func testResultLabelReflectsTapState() {
        XCTAssertEqual(ContentView.resultLabel(tapped: false), "not tapped")
        XCTAssertEqual(ContentView.resultLabel(tapped: true), "tapped")
    }
}
