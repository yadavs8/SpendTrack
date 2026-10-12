package com.spendtrack.app

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.File

/**
 * Shown on the next launch after the app crashed, instead of the normal screen. Deliberately a
 * plain framework Activity -- no Compose, no Room, no DataStore, no ServiceLocator -- so it can
 * never itself be the thing that crashes, even if whatever broke the main screen is still broken.
 */
class CrashActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val report = runCatching { crashFile(this).readText() }.getOrDefault("(could not read the crash report)")

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
            setBackgroundColor(Color.WHITE)
        }

        root.addView(TextView(this).apply {
            text = "Kharcha Book ran into a problem"
            textSize = 20f
            setTextColor(Color.BLACK)
            setPadding(0, 0, 0, 16)
        })
        root.addView(TextView(this).apply {
            text = "It closed last time it opened. The details below are never sent anywhere " +
                "automatically -- copy them if you want to share what happened."
            setTextColor(Color.DKGRAY)
            setPadding(0, 0, 0, 24)
        })

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val reportView = TextView(this).apply {
            text = report
            setTextColor(Color.BLACK)
            textSize = 12f
            setTextIsSelectable(true)
        }
        scroll.addView(reportView)
        root.addView(scroll)

        val buttonRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            setPadding(0, 24, 0, 0)
        }
        buttonRow.addView(Button(this).apply {
            text = "Copy"
            setOnClickListener {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("Kharcha Book crash report", report))
                Toast.makeText(this@CrashActivity, "Copied", Toast.LENGTH_SHORT).show()
            }
        })
        buttonRow.addView(Button(this).apply {
            text = "Continue"
            setOnClickListener {
                runCatching { crashFile(this@CrashActivity).delete() }
                startActivity(Intent(this@CrashActivity, MainActivity::class.java))
                finish()
            }
        })
        root.addView(buttonRow)

        setContentView(root)
    }

    companion object {
        fun crashFile(context: Context): File = File(context.filesDir, "last_crash.txt")

        /** True when there is a crash report from last time waiting to be shown. */
        fun hasPendingCrash(context: Context): Boolean = runCatching { crashFile(context).exists() }.getOrDefault(false)
    }
}
