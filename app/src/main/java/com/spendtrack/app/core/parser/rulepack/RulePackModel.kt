package com.spendtrack.app.core.parser.rulepack

import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType
import org.json.JSONObject

data class ParserRule(
    val id: String,
    val name: String,
    val appPackage: String? = null,
    val senderRegex: Regex? = null,
    val regex: Regex,
    val amountGroup: Int,
    val merchantGroup: Int,
    val vpaGroup: Int? = null,
    val refGroup: Int? = null,
    val accountGroup: Int? = null,
    val paymentMethod: PaymentMethod = PaymentMethod.UPI,
    val transactionType: TransactionType = TransactionType.EXPENSE
) {
    companion object {
        fun fromJson(json: JSONObject): ParserRule {
            val id = json.optString("id", "")
            val name = json.optString("name", "")
            val pkg = json.optString("package").ifBlank { null }
            val sender = json.optString("senderRegex").ifBlank { null }
            val regexStr = json.getString("regex")

            val methodStr = json.optString("method", "UPI")
            val typeStr = json.optString("type", "EXPENSE")

            return ParserRule(
                id = id,
                name = name,
                appPackage = pkg,
                senderRegex = sender?.let { Regex(it) },
                regex = Regex(regexStr),
                amountGroup = json.optInt("amountGroup", 1),
                merchantGroup = json.optInt("merchantGroup", 2),
                vpaGroup = if (json.has("vpaGroup")) json.getInt("vpaGroup") else null,
                refGroup = if (json.has("refGroup")) json.getInt("refGroup") else null,
                accountGroup = if (json.has("accountGroup")) json.getInt("accountGroup") else null,
                paymentMethod = try { PaymentMethod.valueOf(methodStr) } catch (e: Exception) { PaymentMethod.UPI },
                transactionType = try { TransactionType.valueOf(typeStr) } catch (e: Exception) { TransactionType.EXPENSE }
            )
        }
    }
}
