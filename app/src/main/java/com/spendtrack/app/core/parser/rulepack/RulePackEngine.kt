package com.spendtrack.app.core.parser.rulepack

import android.content.Context
import com.spendtrack.app.core.model.ParsedTransaction
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.parser.TransactionParser
import com.spendtrack.app.core.utils.CurrencyUtils
import com.spendtrack.app.data.database.dao.TemplateRuleDao
import org.json.JSONObject
import java.util.Locale

class RulePackEngine(
    private val context: Context,
    private val templateRuleDao: TemplateRuleDao
) {
    private val loadedRules = mutableListOf<ParserRule>()
    @Volatile
    private var isLoaded = false

    // Notifications are parsed concurrently on Dispatchers.IO, so loading must not race
    @Synchronized
    fun loadDefaultRules() {
        if (isLoaded) return
        try {
            val jsonString = context.assets.open("rules_default.json").bufferedReader().use { it.readText() }
            val root = JSONObject(jsonString)
            val rulesArray = root.getJSONArray("rules")
            loadedRules.clear()
            for (i in 0 until rulesArray.length()) {
                val ruleObj = rulesArray.getJSONObject(i)
                loadedRules.add(ParserRule.fromJson(ruleObj))
            }
            isLoaded = true
        } catch (e: Exception) {
            // Fallback: rulepack loading failed, relies on TransactionParser
        }
    }

    suspend fun parse(
        title: String?,
        text: String?,
        sourcePackage: String? = null,
        timestamp: Long = System.currentTimeMillis()
    ): ParsedTransaction? {
        loadDefaultRules()

        val fullText = "${title ?: ""} ${text ?: ""}".trim()
        if (fullText.isBlank()) return null

        // Failed payments, requests and incoming money must never be recorded, whichever parser matches
        if (TransactionParser.shouldIgnore(fullText)) return null
        // Refunds are typed by the heuristic parser; debit-shaped rules would record them as expenses
        if (TransactionParser.isRefund(fullText)) {
            return TransactionParser.parse(title, text, sourcePackage, timestamp)
        }

        val senderOrPkg = sourcePackage ?: title ?: ""

        // 1. Check user-taught custom templates first
        val customTemplates = templateRuleDao.getRulesForSender(senderOrPkg)
        for (template in customTemplates) {
            try {
                val regex = Regex(template.regexPattern)
                val match = regex.find(fullText)
                if (match != null) {
                    val amountStr = match.groupValues.getOrNull(template.amountGroupIndex)?.replace(",", "")
                    val amount = amountStr?.toDoubleOrNull()
                    val merchant = match.groupValues.getOrNull(template.merchantGroupIndex)?.trim()
                    val ref = if (template.refGroupIndex != null) match.groupValues.getOrNull(template.refGroupIndex) else null

                    if (amount != null && amount > 0) {
                        return ParsedTransaction(
                            amount = amount,
                            currency = "INR",
                            merchantRaw = merchant,
                            paymentMethod = PaymentMethod.UPI,
                            transactionType = TransactionType.EXPENSE,
                            upiReference = ref,
                            dateTime = timestamp,
                            source = if (sourcePackage != null) "NOTIFICATION" else "SMS",
                            sourcePackage = sourcePackage,
                            rawText = fullText,
                            confidenceScore = 0.98f // User-taught template: maximum confidence
                        )
                    }
                }
            } catch (e: Exception) {
                // Ignore pattern syntax errors on invalid custom template
            }
        }

        // 2. Check JSON Rule Pack
        for (rule in loadedRules) {
            // App-specific rules only apply to that app's notifications (never to SMS)
            if (rule.appPackage != null && rule.appPackage != sourcePackage) {
                continue
            }
            // Sender-specific rules only apply when the sender matches
            if (rule.senderRegex != null && (title == null || !rule.senderRegex.matches(title))) {
                continue
            }

            val match = rule.regex.find(fullText)
            if (match != null) {
                val amountStr = match.groupValues.getOrNull(rule.amountGroup)?.replace(",", "")
                val amount = amountStr?.toDoubleOrNull()
                val merchant = if (rule.merchantGroup > 0) match.groupValues.getOrNull(rule.merchantGroup)?.trim() else null
                val ref = if (rule.refGroup != null) match.groupValues.getOrNull(rule.refGroup) else null
                val account = if (rule.accountGroup != null) match.groupValues.getOrNull(rule.accountGroup) else null
                val vpa = if (rule.vpaGroup != null) match.groupValues.getOrNull(rule.vpaGroup) else null

                if (amount != null && amount > 0) {
                    return ParsedTransaction(
                        amount = amount,
                        currency = "INR",
                        merchantRaw = merchant,
                        merchantVpa = vpa,
                        paymentMethod = rule.paymentMethod,
                        transactionType = rule.transactionType,
                        upiReference = ref,
                        bankReference = ref,
                        accountLast4 = account,
                        dateTime = timestamp,
                        source = if (sourcePackage != null) "NOTIFICATION" else "SMS",
                        sourcePackage = sourcePackage,
                        rawText = fullText,
                        confidenceScore = 0.95f
                    )
                }
            }
        }

        // 3. Fallback to heuristic parser
        return TransactionParser.parse(
            title = title,
            text = text,
            sourcePackage = sourcePackage,
            timestamp = timestamp
        )
    }
}
