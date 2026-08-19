package dev.mobilecikit.minimal

import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.withContentDescription
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Selects by CONTENT DESCRIPTION, not by view id, on purpose.
 *
 * `withId(R.id.tap_target)` would work here and be marginally faster, but it is not a selector
 * Appium can use -- and the point of this fixture is that the same accessibility ids serve the
 * Espresso lane, the Appium lane, and (via `accessibilityIdentifier`) the iOS lane. Selecting on
 * them here means a rename that would break the Appium specs breaks this test too, in the cheap
 * lane, instead of surfacing later in the expensive one.
 */
@RunWith(AndroidJUnit4::class)
class MainActivityTest {

    @get:Rule
    val activityRule = ActivityScenarioRule(MainActivity::class.java)

    @Test
    fun tappingTheTargetUpdatesTheResultText() {
        onView(withContentDescription("result-text")).check(matches(withText("not tapped")))
        onView(withContentDescription("tap-target")).perform(click())
        onView(withContentDescription("result-text")).check(matches(withText("tapped")))
    }
}
