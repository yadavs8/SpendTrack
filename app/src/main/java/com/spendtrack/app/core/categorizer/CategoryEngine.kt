package com.spendtrack.app.core.categorizer

import com.spendtrack.app.data.database.dao.CategoryDao
import com.spendtrack.app.data.database.dao.MerchantRuleDao
import java.util.Locale

class CategoryEngine(
    private val merchantRuleDao: MerchantRuleDao,
    private val categoryDao: CategoryDao
) {

    private val KEYWORD_MAP = mapOf(
        "cat_food" to listOf(
            "swiggy", "zomato", "restaurant", "cafe", "coffee", "tea", "chai",
            "diner", "burger", "pizza", "bakery", "mcdonald", "kfc", "domino",
            "starbucks", "bar", "brewery", "kitchen", "biryani", "food", "sweets",
            "zepto", "blinkit", "instamart", "bigbasket", "grofers", "supermarket",
            "grocery", "bakes", "dhaba", "canteen"
        ),
        "cat_transport" to listOf(
            "uber", "ola", "rapido", "auto", "taxi", "fuel", "petrol", "diesel",
            "hpcl", "bpcl", "iocl", "shell", "cng", "parking", "toll", "fastag",
            "metro", "dmrc", "bus", "irctc", "railway", "train", "redbus", "chalo"
        ),
        "cat_shopping" to listOf(
            "amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "tata cliq",
            "zara", "h&m", "retail", "mall", "store", "mart", "clothing", "electronics",
            "croma", "reliance digital", "decathlon", "lifestyle", "shoppers stop", "pantaloons"
        ),
        "cat_bills" to listOf(
            "electricity", "bescom", "cesc", "water", "piped gas", "lpg", "cylinder",
            "broadband", "airtel", "jio", "vi", "vodafone", "idea", "bsnl", "dth",
            "tata play", "sun direct", "recharge", "billdesk", "maintenance", "insurance", "lic"
        ),
        "cat_entertainment" to listOf(
            "netflix", "spotify", "hotstar", "prime video", "sonyliv", "zee5",
            "bookmyshow", "cinema", "pvr", "inox", "movie", "theatre", "steam",
            "playstation", "youtube", "gaming", "audible"
        ),
        "cat_health" to listOf(
            "pharmacy", "apollo", "1mg", "netmeds", "medplus", "doctor", "clinic",
            "hospital", "lab", "pathology", "dental", "dentist", "gym", "cult.fit",
            "fitness", "diagnostics", "care", "dr."
        ),
        "cat_personal" to listOf(
            "salon", "spa", "barber", "parlour", "parlor", "beauty", "grooming",
            "naturals", "enrich"
        ),
        "cat_home" to listOf(
            "ikea", "urban ladder", "pepperfry", "furniture", "plumber", "electrician",
            "urban company", "hardware", "paint", "asian paints"
        ),
        "cat_travel" to listOf(
            "flight", "airline", "indigo", "air india", "vistara", "spicejet",
            "hotel", "makemytrip", "goibibo", "cleartrip", "agoda", "booking.com",
            "trip", "resort", "stay", "airbnb", "taj"
        ),
        "cat_financial" to listOf(
            "emi", "loan", "bajaj finance", "mutual fund", "zerodha", "groww",
            "cred", "investment", "bank charges", "fine", "tax", "penalty", "interest"
        )
    )

    data class CategoryResult(
        val categoryId: String,
        val categoryName: String,
        val confidence: Float,
        val isLearnedRule: Boolean = false
    )

    suspend fun resolveCategory(merchantName: String, merchantVpa: String? = null): CategoryResult {
        // 1. Check user learned rules first (Highest priority: 1.0 confidence)
        val userRule = merchantRuleDao.findMatchingRule(merchantName)
        if (userRule != null) {
            return CategoryResult(
                categoryId = userRule.categoryId,
                categoryName = userRule.categoryName,
                confidence = userRule.confidence,
                isLearnedRule = true
            )
        }

        val searchString = (merchantName + " " + (merchantVpa ?: "")).lowercase(Locale.ROOT)

        // 2. Check keyword dictionary
        for ((catId, keywords) in KEYWORD_MAP) {
            for (keyword in keywords) {
                if (searchString.contains(keyword)) {
                    val cat = categoryDao.getCategoryById(catId)
                    return CategoryResult(
                        categoryId = catId,
                        categoryName = cat?.name ?: catId.substringAfter("cat_").replaceFirstChar { it.uppercase() },
                        confidence = 0.95f
                    )
                }
            }
        }

        // 3. Fallback to Other
        val otherCat = categoryDao.getCategoryById("cat_other")
        return CategoryResult(
            categoryId = "cat_other",
            categoryName = otherCat?.name ?: "Other",
            confidence = 0.50f
        )
    }
}
