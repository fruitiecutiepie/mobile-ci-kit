package dev.mobilecikit.minimal

import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * The whole app: one button, one label. Tapping the button changes the label.
 *
 * This exists to be driven by a real Espresso run and a real Appium run, so the CI lanes in this
 * repo have something to prove themselves against. It is deliberately trivial -- a lane fixture,
 * not an app -- because every line of product behaviour here is a line that can break the lane for
 * reasons that have nothing to do with the lane.
 */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val result = findViewById<TextView>(R.id.result_text)
        findViewById<Button>(R.id.tap_target).setOnClickListener {
            result.text = getString(R.string.tapped)
        }
    }
}
