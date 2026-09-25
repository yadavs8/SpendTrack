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
import com.spendtrack.app.data.database.entity.TemplateRuleEntity
import java.util.UUID

@Composable
fun TeachFormatDialog(
    senderOrPackage: String,
    rawText: String,
    onDismiss: () -> Unit,
    onSaveTemplate: (TemplateRuleEntity) -> Unit
) {
    var amountSnippet by remember { mutableStateOf("") }
    var merchantSnippet by remember { mutableStateOf("") }
    var refSnippet by remember { mutableStateOf("") }

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
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (amountSnippet.isNotBlank() && merchantSnippet.isNotBlank()) {
                        // Generate a regex pattern dynamically based on user snippets
                        val escapedText = Regex.escape(rawText)
                        val escapedAmount = Regex.escape(amountSnippet.trim())
                        val escapedMerchant = Regex.escape(merchantSnippet.trim())

                        val pattern = escapedText
                            .replace(escapedAmount, "([0-9,]+(?:\\.[0-9]{1,2})?)")
                            .replace(escapedMerchant, "([^.\\n]+?)")

                        val rule = TemplateRuleEntity(
                            id = UUID.randomUUID().toString(),
                            senderOrPackage = senderOrPackage,
                            regexPattern = pattern,
                            amountGroupIndex = 1,
                            merchantGroupIndex = 2
                        )
                        onSaveTemplate(rule)
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
