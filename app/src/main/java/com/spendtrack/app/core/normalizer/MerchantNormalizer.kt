package com.spendtrack.app.core.normalizer

import java.util.Locale

object MerchantNormalizer {

    private val PREFIX_PATTERNS = listOf(
        Regex("""(?i)^UPI[-/:]\s*"""),
        Regex("""(?i)^PAY\s*TO\s*"""),
        Regex("""(?i)^PAID\s*TO\s*"""),
        Regex("""(?i)^PURCHASE\s*AT\s*"""),
        Regex("""(?i)^POS\s*"""),
        Regex("""(?i)^VPA[-/:]?\s*"""),
        Regex("""(?i)^BILLDESK[-/:]?\s*"""),
        Regex("""(?i)^RAZORPAY[-/:]?\s*""")
    )

    private val VPA_SUFFIX_REGEX = Regex("""(?i)@[a-zA-Z0-9.\-_]+$""")
    private val REF_SUFFIX_REGEX = Regex("""(?i)[-/]\s*(?:ref|utr|txn|rrn|no)?\s*\d{6,16}$""")
    private val EXTRA_CLEANUP_REGEX = Regex("""(?i)\b(pvt|ltd|limited|india|tech|services|retail|payments?)\b""")

    // Dictionary of known merchants
    private val KNOWN_MERCHANTS = mapOf(
        "AMAZON" to "Amazon",
        "AMZN" to "Amazon",
        "FLIPKART" to "Flipkart",
        "SWIGGY" to "Swiggy",
        "BUNDL" to "Swiggy",
        "ZOMATO" to "Zomato",
        "UBER" to "Uber",
        "OLA" to "Ola",
        "ANI TECHNOLOGIES" to "Ola",
        "ZEPTO" to "Zepto",
        "KIRANAKART" to "Zepto",
        "BLINKIT" to "Blinkit",
        "GROFERS" to "Blinkit",
        "BIGBASKET" to "BigBasket",
        "INNOVATIVE RETAIL" to "BigBasket",
        "INSTAMART" to "Swiggy Instamart",
        "HPCL" to "HPCL Fuel",
        "HINDUSTAN PETROLEUM" to "HPCL Fuel",
        "BPCL" to "BPCL Fuel",
        "BHARAT PETROLEUM" to "BPCL Fuel",
        "IOCL" to "Indian Oil",
        "INDIAN OIL" to "Indian Oil",
        "NETFLIX" to "Netflix",
        "SPOTIFY" to "Spotify",
        "AIRTEL" to "Airtel",
        "JIO" to "Jio",
        "DMRC" to "Delhi Metro",
        "DELHI METRO" to "Delhi Metro",
        "IRCTC" to "IRCTC",
        "APOLLO" to "Apollo Pharmacy",
        "1MG" to "Tata 1mg",
        "TATA 1MG" to "Tata 1mg",
        "MYNTRA" to "Myntra",
        "STARBUCKS" to "Starbucks",
        "MCDONALDS" to "McDonald's",
        "DOMINOS" to "Domino's Pizza",
        "BOOKMYSHOW" to "BookMyShow",
        "MAKEMYTRIP" to "MakeMyTrip",
        "CLEARTRIP" to "Cleartrip",
        "CRED" to "CRED",
        "PAYTM" to "Paytm"
    )

    fun normalize(rawMerchant: String?, vpa: String? = null): String {
        if (rawMerchant.isNullOrBlank() && vpa.isNullOrBlank()) {
            return "Unknown Merchant"
        }

        // Try raw merchant first, fallback to VPA prefix
        var input: String = if (!rawMerchant.isNullOrBlank()) {
            rawMerchant.trim()
        } else if (!vpa.isNullOrBlank()) {
            vpa.substringBefore('@').replace(".", " ").trim()
        } else {
            "Unknown Merchant"
        }

        // 1. Remove prefixes
        for (pattern in PREFIX_PATTERNS) {
            input = pattern.replace(input, "").trim()
        }

        // 2. Remove VPA suffix if present in name
        input = VPA_SUFFIX_REGEX.replace(input, "").trim()

        // 3. Remove trailing transaction or reference numbers
        input = REF_SUFFIX_REGEX.replace(input, "").trim()

        // 4. Check known merchant mappings
        val upperInput = input.uppercase(Locale.ROOT)
        for ((key, normalizedName) in KNOWN_MERCHANTS) {
            if (upperInput.contains(key)) {
                return normalizedName
            }
        }

        // 5. Clean up legal suffixes if making name overly complex
        val cleaned = EXTRA_CLEANUP_REGEX.replace(input, "").trim()
            .replace(Regex("""\s+"""), " ")
            .trim(',', '.', '-', ' ')

        val result = if (cleaned.length >= 2) cleaned else input

        // 6. Format Title Case
        return toTitleCase(result)
    }

    private fun toTitleCase(text: String): String {
        return text.split(" ")
            .filter { it.isNotBlank() }
            .joinToString(" ") { word ->
                if (word.length <= 1) word.uppercase(Locale.ROOT)
                else word.take(1).uppercase(Locale.ROOT) + word.substring(1).lowercase(Locale.ROOT)
            }
    }
}
