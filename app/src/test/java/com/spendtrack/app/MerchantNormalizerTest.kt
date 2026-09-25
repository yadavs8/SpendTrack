package com.spendtrack.app

import com.spendtrack.app.core.normalizer.MerchantNormalizer
import org.junit.Assert.assertEquals
import org.junit.Test

class MerchantNormalizerTest {

    @Test
    fun normalize_complexUpiStrings_cleansToCleanBrand() {
        assertEquals("Amazon", MerchantNormalizer.normalize("UPI-AMAZON PAY INDIA-AMAZON@ICICI"))
        assertEquals("Swiggy", MerchantNormalizer.normalize("UPI/Swiggy/xxxx"))
        assertEquals("Swiggy", MerchantNormalizer.normalize("BUNDL TECHNOLOGIES PVT LTD"))
        assertEquals("Zomato", MerchantNormalizer.normalize("PAY TO ZOMATO LIMITED"))
        assertEquals("Uber", MerchantNormalizer.normalize("UBER INDIA SYSTEMS PVT LTD"))
        assertEquals("HPCL Fuel", MerchantNormalizer.normalize("HINDUSTAN PETROLEUM CORP"))
        assertEquals("Netflix", MerchantNormalizer.normalize("POS PURCHASE NETFLIX"))
        assertEquals("Zepto", MerchantNormalizer.normalize("KIRANAKART TECHNOLOGIES"))
    }

    @Test
    fun normalize_unknownMerchant_formatsTitleCase() {
        assertEquals("Chai Point Indiranagar", MerchantNormalizer.normalize("CHAI POINT INDIRANAGAR"))
        assertEquals("Ramesh Grocery", MerchantNormalizer.normalize("PAY TO RAMESH GROCERY"))
    }

    @Test
    fun normalize_fallbackToVpa_extractsMerchantFromVpa() {
        assertEquals("Ramesh Stores", MerchantNormalizer.normalize(null, "ramesh.stores@oksbi"))
    }

    @Test
    fun normalize_shortBrandKeys_matchWholeWordsOnly() {
        assertEquals("Ola", MerchantNormalizer.normalize("OLA CABS"))
        assertEquals("Coca Cola Store", MerchantNormalizer.normalize("COCA COLA STORE"))
        assertEquals("Solanki Traders", MerchantNormalizer.normalize("SOLANKI TRADERS"))
    }
}
