package com.spendtrack.app.core.backup

import android.content.Context
import android.net.Uri
import androidx.core.content.FileProvider
import com.spendtrack.app.core.categorizer.CategoryEngine
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.core.model.TransactionType
import com.spendtrack.app.core.normalizer.MerchantNormalizer
import com.spendtrack.app.data.database.entity.TransactionEntity
import com.spendtrack.app.data.repository.TransactionRepository
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

// Values in a "Type" / "Dr/Cr" column that mean the row is NOT an expense
private val NON_EXPENSE_ROW_TYPES = setOf("CR", "CREDIT", "C", "INCOME", "REFUND", "INTERNAL_TRANSFER", "UNKNOWN")

// Formats used by SpendTrack's own export and common Indian bank statements
private val IMPORT_DATE_FORMATS = listOf(
    "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd",
    "dd/MM/yyyy HH:mm:ss", "dd/MM/yyyy", "dd/MM/yy",
    "dd-MM-yyyy", "dd-MM-yy", "dd-MMM-yyyy", "dd-MMM-yy",
    "dd MMM yyyy", "dd MMM yy", "dd.MM.yyyy"
)

class DataImportExportManager(
    private val transactionRepository: TransactionRepository,
    private val categoryEngine: CategoryEngine
) {

    private val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

    fun exportToCsv(transactions: List<TransactionEntity>): String {
        val sb = StringBuilder()
        sb.append("ID,Date,Time,Merchant,Amount,Category,Payment Method,Transaction Type,Reference,Notes\n")

        for (t in transactions) {
            val dateStr = dateFormat.format(Date(t.dateTime))
            val timeStr = timeFormat.format(Date(t.dateTime))
            val merchant = escapeCsv(t.merchantName ?: "")
            val category = escapeCsv(t.categoryId ?: "")
            val method = t.paymentMethod.displayName
            val type = t.transactionType.name
            val ref = escapeCsv(t.upiReference ?: t.bankReference ?: "")
            val notes = escapeCsv(t.description ?: "")

            sb.append("${t.id},$dateStr,$timeStr,$merchant,${t.amount},$category,$method,$type,$ref,$notes\n")
        }
        return sb.toString()
    }

    fun exportToJson(transactions: List<TransactionEntity>): String {
        val jsonArray = JSONArray()
        for (t in transactions) {
            val obj = JSONObject().apply {
                put("id", t.id)
                put("amount", t.amount)
                put("currency", t.currency)
                put("merchantName", t.merchantName)
                put("merchantVpa", t.merchantVpa)
                put("description", t.description)
                put("categoryId", t.categoryId)
                put("paymentMethod", t.paymentMethod.name)
                put("transactionType", t.transactionType.name)
                put("dateTime", t.dateTime)
                put("upiReference", t.upiReference)
                put("bankReference", t.bankReference)
                put("accountLast4", t.accountLast4)
                put("source", t.source)
            }
            jsonArray.put(obj)
        }
        return jsonArray.toString(2)
    }

    fun exportCsvToFile(context: Context, transactions: List<TransactionEntity>): Uri {
        val csv = exportToCsv(transactions)
        val exportDir = File(context.cacheDir, "exports").apply { mkdirs() }
        val file = File(exportDir, "SpendTrack_Expenses_${System.currentTimeMillis()}.csv")
        file.writeText(csv)
        return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    }

    fun exportJsonToFile(context: Context, transactions: List<TransactionEntity>): Uri {
        val json = exportToJson(transactions)
        val exportDir = File(context.cacheDir, "exports").apply { mkdirs() }
        val file = File(exportDir, "SpendTrack_Backup_${System.currentTimeMillis()}.json")
        file.writeText(json)
        return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    }

    data class ImportResult(
        val totalRows: Int,
        val importedExpenses: Int,
        val skippedCredits: Int,
        val failedRows: Int
    )

    suspend fun importFromCsv(inputStream: InputStream): ImportResult {
        val reader = inputStream.bufferedReader()
        val lines = reader.readLines()
        if (lines.isEmpty()) return ImportResult(0, 0, 0, 0)

        val header = parseCsvLine(lines.first()).map { it.trim().lowercase(Locale.ROOT) }
        val dateIdx = header.indexOfFirst { it.contains("date") }
        val timeIdx = header.indexOfFirst { it == "time" }
        val typeIdx = header.indexOfFirst { it == "transaction type" || it == "type" || it == "dr/cr" || it == "cr/dr" }
        val descIdx = header.indexOfFirst { it.contains("desc") || it.contains("narration") || it.contains("particular") || it.contains("merchant") }
        val debitIdx = header.indexOfFirst { it.contains("debit") || it.contains("withdrawal") }
        val creditIdx = header.indexOfFirst { it.contains("credit") || it.contains("deposit") }
        val amountIdx = header.indexOfFirst { it.contains("amount") }

        var imported = 0
        var skipped = 0
        var failed = 0

        val rowLines = lines.drop(1)
        for (line in rowLines) {
            if (line.isBlank()) continue
            try {
                val cols = parseCsvLine(line)

                // Check debit vs credit
                var debitAmount: Double? = null
                var creditAmount: Double? = null

                if (debitIdx != -1 && debitIdx < cols.size) {
                    debitAmount = cleanAmount(cols[debitIdx])
                }
                if (creditIdx != -1 && creditIdx < cols.size) {
                    creditAmount = cleanAmount(cols[creditIdx])
                }

                // If credit amount is positive, explicitly ignore!
                if (creditAmount != null && creditAmount > 0.0) {
                    skipped++
                    continue
                }

                // Rows marked as credit / refund / transfer (bank "Dr/Cr" column or SpendTrack's own export)
                val rowType = if (typeIdx != -1 && typeIdx < cols.size) cols[typeIdx].trim().uppercase(Locale.ROOT) else ""
                if (rowType in NON_EXPENSE_ROW_TYPES) {
                    skipped++
                    continue
                }

                val finalAmount = debitAmount ?: if (amountIdx != -1 && amountIdx < cols.size) cleanAmount(cols[amountIdx]) else null
                if (finalAmount == null || finalAmount <= 0.0) {
                    failed++
                    continue
                }

                val desc = if (descIdx != -1 && descIdx < cols.size) cols[descIdx] else "Statement Import"
                val normalizedMerchant = MerchantNormalizer.normalize(desc)
                val catResult = categoryEngine.resolveCategory(normalizedMerchant)
                val dateStr = if (dateIdx != -1 && dateIdx < cols.size) cols[dateIdx] else null
                val timeStr = if (timeIdx != -1 && timeIdx < cols.size) cols[timeIdx] else null
                val dateTime = parseDate(dateStr, timeStr) ?: System.currentTimeMillis()

                transactionRepository.addManualExpense(
                    amount = finalAmount,
                    merchantName = normalizedMerchant,
                    categoryId = catResult.categoryId,
                    paymentMethod = PaymentMethod.UPI,
                    dateTime = dateTime,
                    description = desc
                )
                imported++
            } catch (e: Exception) {
                failed++
            }
        }

        return ImportResult(
            totalRows = rowLines.size,
            importedExpenses = imported,
            skippedCredits = skipped,
            failedRows = failed
        )
    }

    private fun parseDate(date: String?, time: String?): Long? {
        if (date.isNullOrBlank()) return null
        val candidates = if (!time.isNullOrBlank()) listOf("${date.trim()} ${time.trim()}", date.trim()) else listOf(date.trim())
        for (value in candidates) {
            for (pattern in IMPORT_DATE_FORMATS) {
                try {
                    val format = SimpleDateFormat(pattern, Locale.ENGLISH).apply { isLenient = false }
                    val parsed = format.parse(value) ?: continue
                    return parsed.time
                } catch (e: Exception) {
                    // try next format
                }
            }
        }
        return null
    }

    private fun cleanAmount(raw: String): Double? {
        val cleaned = raw.replace("₹", "")
            .replace("Rs.", "", ignoreCase = true)
            .replace("Rs", "", ignoreCase = true)
            .replace("INR", "", ignoreCase = true)
            .replace(",", "")
            .trim()
        return cleaned.toDoubleOrNull()
    }

    private fun escapeCsv(value: String): String {
        return if (value.contains(",") || value.contains("\"") || value.contains("\n")) {
            "\"" + value.replace("\"", "\"\"") + "\""
        } else {
            value
        }
    }

    private fun parseCsvLine(line: String): List<String> {
        val tokens = mutableListOf<String>()
        val sb = StringBuilder()
        var inQuotes = false

        for (ch in line) {
            when {
                ch == '\"' -> inQuotes = !inQuotes
                ch == ',' && !inQuotes -> {
                    tokens.add(sb.toString().trim())
                    sb.clear()
                }
                else -> sb.append(ch)
            }
        }
        tokens.add(sb.toString().trim())
        return tokens
    }
}
