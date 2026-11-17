package com.spendtrack.app

import com.spendtrack.app.ui.screens.webview.isKharchaBookUrl
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The bridge that hands out the sign-in token answers only SpendTrack itself (audit M3). */
class KharchaBookUrlTest {

    @Test
    fun kharchaBookPagesAreTrusted() {
        assertTrue(isKharchaBookUrl("https://yadavs8.github.io/SpendTrack/web/kharcha-book/"))
        assertTrue(isKharchaBookUrl("https://yadavs8.github.io/SpendTrack/web/kharcha-book/index.html?v=150#add"))
        assertTrue(isKharchaBookUrl("https://yadavs8.github.io/SpendTrack/web/kharcha-book/trip.html?t=abc"))
    }

    @Test
    fun lookAlikesAreNot() {
        assertFalse(isKharchaBookUrl("https://yadavs8.github.io.evil.com/SpendTrack/web/kharcha-book/"))
        assertFalse(isKharchaBookUrl("https://evil.com/SpendTrack/web/kharcha-book/"))
        assertFalse(isKharchaBookUrl("https://yadavs8.github.io/other-repo/"))
        assertFalse(isKharchaBookUrl("https://yadavs8.github.io/SpendTrack/web/other/"))
        assertFalse(isKharchaBookUrl("http://yadavs8.github.io/SpendTrack/web/kharcha-book/"))
        assertFalse(isKharchaBookUrl("https://yadavs8.github.io:8443/SpendTrack/web/kharcha-book/"))
        assertFalse(isKharchaBookUrl("https://user@yadavs8.github.io/SpendTrack/web/kharcha-book/"))
        assertFalse(isKharchaBookUrl("javascript:alert(1)"))
        assertFalse(isKharchaBookUrl(null))
        assertFalse(isKharchaBookUrl(""))
    }
}
