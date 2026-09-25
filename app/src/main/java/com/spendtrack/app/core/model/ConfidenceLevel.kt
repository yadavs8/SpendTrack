package com.spendtrack.app.core.model

/**
 * Parsing confidence level.
 * High (>= 0.90): automatically recorded.
 * Medium (0.70 - 0.89): recorded with Review badge.
 * Low (< 0.70): placed in "Needs Review" queue for confirmation.
 */
enum class ConfidenceLevel(val threshold: Float) {
    HIGH(0.90f),
    MEDIUM(0.70f),
    LOW(0.0f);

    companion object {
        fun fromScore(score: Float): ConfidenceLevel {
            return when {
                score >= HIGH.threshold -> HIGH
                score >= MEDIUM.threshold -> MEDIUM
                else -> LOW
            }
        }
    }
}
