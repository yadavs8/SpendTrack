package com.spendtrack.app.core.parser

import com.spendtrack.app.core.model.PaymentMethod

/**
 * Works out *how* a payment was made -- credit card, debit card, UPI, ATM, net banking or wallet --
 * plus the card/account's last digits and the bank, from a bank SMS or app notification.
 *
 * Order matters, and every rule is driven by real Indian bank SMS wording:
 *  1. ATM / cash withdrawal ("withdrawn at ATM", "Cash Wdl").
 *  2. An explicit "credit card", or a card with an available *limit* (only credit cards have one).
 *     A RuPay credit card used over UPI is still a credit card spend -- it lands on the card bill.
 *  3. An explicit "debit card", or POS/ECOM card use that debits a bank account.
 *  4. UPI signals: a UPI ID, the word UPI, a UPI reference, or a UPI app.
 *  5. NEFT / IMPS / RTGS / NACH / net banking.
 *  6. A bare "card XX1234": a bank account or balance mentioned means debit card, otherwise credit
 *     (banks write "Debit Card" on debit-card alerts; the bare "Bank Card" wording is their credit cards).
 *  7. Wallets (Paytm wallet, Amazon Pay balance, ...).
 * [registeredCredit]/[registeredDebit] are last-4s the user marked in Settings → Accounts; they win
 * over wording, since the user knows their own cards.
 */
object PaymentInstrumentClassifier {

    data class Instrument(val method: PaymentMethod, val last4: String?, val bank: String?)

    // A cash withdrawal, not just any mention of "ATM" (an "ATM cum debit card" purchase is a card spend).
    private val CASH_WITHDRAWAL = Regex("""(?i)\bcash\s*(?:wdl|withdrawal|withdrawn)\b|\batm\s*(?:wdl|withdrawal|cash)\b""")
    private val ATM_WORD = Regex("""(?i)\batm\b""")
    private val WITHDRAW_WORD = Regex("""(?i)\b(?:withdrawn|withdrawal|wdl)\b""")
    private val CREDIT_CARD = Regex("""(?i)\bcredit\s*card\b|\bcc\s*(?:no\.?|ending|xx|\*{2,})|\b(?:sbi\s*card|sbicrd|amex|american\s+express|onecard|one\s*card|scapia|uni\s*card)\b""")
    private val CARD_LIMIT = Regex("""(?i)\b(?:avl|avail(?:able)?)\.?\s*(?:credit\s*)?(?:lmt|limit)\b|\bcredit\s*limit\b""")
    private val DEBIT_CARD = Regex("""(?i)\bdebit\s*card\b|\batm\s*cum\s*debit\b|\brupay\s*debit\b""")
    private val POS_ECOM = Regex("""(?i)\b(?:pos|ecom|e-com)\b""")
    private val CARD = Regex("""(?i)\bcard\b""")
    private val BANK_ACCOUNT = Regex("""(?i)\b(?:a/c|acct|account|savings)\b|\b(?:avl|avail(?:able)?)\.?\s*bal""")
    private val UPI = Regex("""(?i)\bupi\b|[a-z0-9._-]{2,}@[a-z]{2,}\b|\bvpa\b""")
    private val NET_BANKING = Regex("""(?i)\b(?:neft|imps|rtgs|nach|ecs|net\s*banking|netbanking|internet\s*banking|auto[- ]?debit|si\s+debit|standing\s+instruction)\b""")
    private val WALLET = Regex("""(?i)\bwallet\b|\bamazon\s*pay\s*balance\b|\bpaytm\s*balance\b""")

    private val CARD_LAST4 = Regex("""(?i)\bcard\b[^0-9]{0,25}?(?:ending\s*(?:in|with)?\s*|no\.?\s*|[x*]+\s*)(\d{4})\b|\bcard\s+(\d{4})\b|\bcc\s*(?:no\.?|ending|xx|\*+)\s*(\d{4})\b""")
    private val ACCOUNT_LAST4 = Regex("""(?i)(?:a/c|acct|account)\s*(?:no\.?)?\s*[*xX]{0,12}(\d{3,6})\b""")

    private val BANKS = listOf(
        "HDFC" to Regex("""(?i)\bhdfc"""),
        "ICICI" to Regex("""(?i)\bicici"""),
        "SBI Card" to Regex("""(?i)\bsbi\s*(?:credit\s*)?card|\bsbicrd"""),
        "SBI" to Regex("""(?i)\bsbi\b|\bstate\s+bank|sbiinb|sbiupi|sbipsg"""),
        "Axis" to Regex("""(?i)\baxis"""),
        "Kotak" to Regex("""(?i)\bkotak"""),
        "IDFC FIRST" to Regex("""(?i)\bidfc"""),
        "IndusInd" to Regex("""(?i)\bindusind|\bindusb"""),
        "Yes Bank" to Regex("""(?i)\byes\s*bank|\byesbnk"""),
        "AU Bank" to Regex("""(?i)\bau\s*(?:small\s*finance\s*)?bank|\baubank"""),
        "RBL" to Regex("""(?i)\brbl"""),
        "PNB" to Regex("""(?i)\bpnb\b|punjab\s+national"""),
        "Bank of Baroda" to Regex("""(?i)\bbank\s+of\s+baroda|\bbob\b"""),
        "Canara" to Regex("""(?i)\bcanara|\bcanbnk"""),
        "Union Bank" to Regex("""(?i)\bunion\s+bank|\bunionb"""),
        "Federal" to Regex("""(?i)\bfederal\s+bank|\bfedbnk"""),
        "Amex" to Regex("""(?i)\bamex\b|american\s+express"""),
        "OneCard" to Regex("""(?i)\bone\s*card"""),
        "Paytm" to Regex("""(?i)\bpaytm"""),
        "Jupiter" to Regex("""(?i)\bjupiter"""),
        "Fi" to Regex("""(?i)\bfi\s+money|\bepifi""")
    )

    fun classify(
        text: String,
        sender: String? = null,
        sourcePackage: String? = null,
        registeredCredit: Set<String> = emptySet(),
        registeredDebit: Set<String> = emptySet()
    ): Instrument {
        val all = listOfNotNull(sender, text).joinToString(" ")
        val cardLast4 = CARD_LAST4.find(text)?.groupValues?.drop(1)?.firstOrNull { it.isNotBlank() }
        val accountLast4 = ACCOUNT_LAST4.find(text)?.groupValues?.get(1)
        val bank = bankOf(all)

        // The user's own registered cards beat any wording.
        if (cardLast4 != null && cardLast4 in registeredCredit) return Instrument(PaymentMethod.CREDIT_CARD, cardLast4, bank)
        if (cardLast4 != null && cardLast4 in registeredDebit) return Instrument(PaymentMethod.DEBIT_CARD, cardLast4, bank)

        val method = when {
            isCashWithdrawal(text) -> PaymentMethod.ATM
            CREDIT_CARD.containsMatchIn(all) -> PaymentMethod.CREDIT_CARD
            CARD.containsMatchIn(text) && CARD_LIMIT.containsMatchIn(text) -> PaymentMethod.CREDIT_CARD
            DEBIT_CARD.containsMatchIn(text) -> PaymentMethod.DEBIT_CARD
            POS_ECOM.containsMatchIn(text) && (CARD.containsMatchIn(text) || BANK_ACCOUNT.containsMatchIn(text)) -> PaymentMethod.DEBIT_CARD
            UPI.containsMatchIn(text) || (sourcePackage != null && sourcePackage in TransactionParser.MONITORED_UPI_PACKAGES) -> PaymentMethod.UPI
            NET_BANKING.containsMatchIn(text) -> PaymentMethod.BANK_TRANSFER
            CARD.containsMatchIn(text) -> if (BANK_ACCOUNT.containsMatchIn(text)) PaymentMethod.DEBIT_CARD else PaymentMethod.CREDIT_CARD
            WALLET.containsMatchIn(text) -> PaymentMethod.WALLET
            BANK_ACCOUNT.containsMatchIn(text) -> PaymentMethod.BANK_TRANSFER
            else -> PaymentMethod.OTHER
        }
        val last4 = when (method) {
            PaymentMethod.CREDIT_CARD, PaymentMethod.DEBIT_CARD -> cardLast4 ?: accountLast4
            else -> accountLast4 ?: cardLast4
        }
        return Instrument(method, last4, bank)
    }

    /** Money taken out as cash (ATM, or a "cash withdrawal" at a branch / micro-ATM). */
    fun isCashWithdrawal(text: String): Boolean =
        CASH_WITHDRAWAL.containsMatchIn(text) || (ATM_WORD.containsMatchIn(text) && WITHDRAW_WORD.containsMatchIn(text))

    fun bankOf(text: String): String? = BANKS.firstOrNull { it.second.containsMatchIn(text) }?.first
}
