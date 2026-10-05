package com.spendtrack.app.core.network

/**
 * Same Supabase project the Kharcha Book web app points at (web/kharcha-book/config.js).
 * The anon key is safe to ship in the APK; Row Level Security on `daily_expenses` restricts
 * every request to the signed-in user's own rows.
 */
object SupabaseConfig {
    const val SUPABASE_URL = "https://qyjsvumaottbatpdvsaw.supabase.co"
    const val SUPABASE_ANON_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5anN2dW1hb3R0YmF0cGR2c2F3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4ODQxNzIsImV4cCI6MjEwNTQ2MDE3Mn0.j6NQHczqCZBopIzO8oe5gliH_6N3q8lgc80mDlIQtJA"
}
