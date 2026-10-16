package com.spendtrack.app.core.deduplication

import android.content.Context
import org.json.JSONObject

/**
 * Remembers which money messages were already read (for a few days, on this phone only), so the
 * same SMS or notification is read once however many times it comes back. See [MessageFingerprint]
 * for what counts as the same message.
 */
object SeenMessages {

    private const val PREFS = "kharcha_seen_messages"
    private const val KEY = "seen"
    private const val MAX_ENTRIES = 400
    private val lock = Any()

    /**
     * True if [text] was already read (so it must be skipped); otherwise records it and returns false.
     * [postedAt] is the notification's / SMS's own time, which a re-post of the same notification keeps.
     */
    fun checkAndRemember(context: Context, text: String?, postedAt: Long, now: Long = System.currentTimeMillis()): Boolean {
        if (text.isNullOrBlank()) return false
        val key = MessageFingerprint.keyOf(text)
        synchronized(lock) {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val all = runCatching { JSONObject(prefs.getString(KEY, "{}") ?: "{}") }.getOrElse { JSONObject() }
            val prev = all.optJSONObject(key)?.let { MessageFingerprint.Seen(it.optLong("at"), it.optLong("posted")) }
            if (MessageFingerprint.isRepeat(prev, text, postedAt, now)) return true

            all.put(key, JSONObject().put("at", now).put("posted", postedAt))
            // Forget old entries, and keep the newest few hundred.
            val keys = all.keys().asSequence().toList()
            val stale = keys.filter { now - (all.optJSONObject(it)?.optLong("at") ?: 0L) > MessageFingerprint.KEEP_FOR_MS }
            stale.forEach { all.remove(it) }
            if (all.length() > MAX_ENTRIES) {
                all.keys().asSequence().toList()
                    .sortedBy { all.optJSONObject(it)?.optLong("at") ?: 0L }
                    .take(all.length() - MAX_ENTRIES)
                    .forEach { all.remove(it) }
            }
            prefs.edit().putString(KEY, all.toString()).apply()
            return false
        }
    }
}
