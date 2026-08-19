import SwiftUI

/// The cross-platform selector contract, as constants.
///
/// These strings must match `examples/minimal-android`'s `contentDescription` values exactly:
/// `accessibilityIdentifier` on iOS and `contentDescription` on Android both surface to Appium as
/// `~<id>`, which is what lets ONE spec drive both platforms with no branching.
///
/// They are constants rather than inline literals so a rename is a compile-visible change and so the
/// unit test can assert them. A mismatch would otherwise fail nothing at build time and surface much
/// later as an Appium timeout on one platform only.
public enum A11y {
    public static let tapTarget = "tap-target"
    public static let resultText = "result-text"
}

/// The whole app: one button, one label. Tapping the button changes the label.
///
/// The counterpart of `examples/minimal-android`, deliberately identical in behaviour and in
/// accessibility ids. It is a lane fixture, not an app.
@main
struct MinimalApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

public struct ContentView: View {
    @State private var tapped = false

    public init() {}

    /// Extracted so the unit test can assert the label logic without launching a simulator.
    public static func resultLabel(tapped: Bool) -> String {
        tapped ? "tapped" : "not tapped"
    }

    public var body: some View {
        VStack(spacing: 24) {
            Text(Self.resultLabel(tapped: tapped))
                .font(.title2)
                .accessibilityIdentifier(A11y.resultText)

            Button("Tap me") {
                tapped = true
            }
            .accessibilityIdentifier(A11y.tapTarget)
        }
        .padding()
    }
}
