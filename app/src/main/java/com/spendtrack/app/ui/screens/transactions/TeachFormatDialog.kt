package com.spendtrack.app.ui.screens.transactions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.spendtrack.app.core.parser.rulepack.TemplateBuilder
import com.spendtrack.app.data.database.entity.TemplateRuleEntity
import java.util.UUID

@Composable
fun TeachFormatDialog(
    senderOrPackage: String,
    rawText: String,
    onDismiss: () -> Unit,
    onSaveTemplate: (rule: TemplateRuleEntity, amount: Double, merchant: String) -> Unit
) {
    var amountSnippet by remember { mutableStateOf("") }
    var merchantSnippet by remember { mutableStateOf("") }
    var refSnippet by remember { mutableStateOf("") }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text("Teach This Format", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    "Teach SpendTrack how to parse messages from this sender for future automatic detection:",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // Raw message display
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text(
                        text = rawText,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(12.dp)
                    )
                }

                OutlinedTextField(
                    value = amountSnippet,
                    onValueChange = { amountSnippet = it },
                    label = { Text("Exact Amount in text") },
                    placeholder = { Text("e.g. 450.00") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                )

                OutlinedTextField(
                    value = merchantSnippet,
                    onValueChange = { merchantSnippet = it },
                    label = { Text("Exact Merchant in text") },
                    placeholder = { Text("e.g. Chai Point or Swiggy") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                )

                OutlinedTextField(
                    value = refSnippet,
                    onValueChange = { refSnippet = it },
                    label = { Text("Reference / UTR in text (Optional)") },
                    placeholder = { Text("e.g. 123456789012") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                )

                if (errorMessage != null) {
                    Text(
                        text = errorMessage!!,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val template = TemplateBuilder.build(
                        rawText = rawText,
                        amount = amountSnippet,
                        merchant = merchantSnippet,
                        ref = refSnippet.ifBlank { null }
                    )
                    if (template == null) {
                        errorMessage = "Copy the amount, merchant and reference exactly as they appear in the message above."
                    } else {
                        val rule = TemplateRuleEntity(
                            id = UUID.randomUUID().toString(),
                            senderOrPackage = senderOrPackage,
                            regexPattern = template.regexPattern,
                            amountGroupIndex = template.amountGroupIndex,
                            merchantGroupIndex = template.merchantGroupIndex,
                            refGroupIndex = template.refGroupIndex
                        )
                        val amount = amountSnippet.trim().replace(",", "").toDoubleOrNull() ?: 0.0
                        onSaveTemplate(rule, amount, merchantSnippet.trim())
                    }
                },
                enabled = amountSnippet.isNotBlank() && merchantSnippet.isNotBlank()
            ) {
                Text("Save Template")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}
