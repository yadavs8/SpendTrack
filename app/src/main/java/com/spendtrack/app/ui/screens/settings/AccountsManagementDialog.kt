package com.spendtrack.app.ui.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.spendtrack.app.data.database.entity.AccountType
import com.spendtrack.app.data.database.entity.UserAccountEntity
import com.spendtrack.app.ui.theme.CoralRed

@Composable
fun AccountsManagementDialog(
    accounts: List<UserAccountEntity>,
    onDismiss: () -> Unit,
    onAddAccount: (bankName: String, last4: String, type: AccountType, nickname: String?) -> Unit,
    onDeleteAccount: (String) -> Unit
) {
    var showAddForm by remember { mutableStateOf(false) }
    var bankName by remember { mutableStateOf("") }
    var last4 by remember { mutableStateOf("") }
    var nickname by remember { mutableStateOf("") }
    var selectedType by remember { mutableStateOf(AccountType.SAVINGS) }
    var accountPendingDeletion by remember { mutableStateOf<UserAccountEntity?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text("Registered Accounts & Cards", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    "Used to accurately identify transfers between your own accounts and prevent double-counting credit card bill payments.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                if (showAddForm) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(
                                value = bankName,
                                onValueChange = { bankName = it },
                                label = { Text("Bank / Issuer Name") },
                                placeholder = { Text("e.g. HDFC, SBI, ICICI") },
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(10.dp)
                            )
                            OutlinedTextField(
                                value = last4,
                                onValueChange = { if (it.length <= 4) last4 = it },
                                label = { Text("Last 4 Digits") },
                                placeholder = { Text("e.g. 1234") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(10.dp)
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                AccountType.values().forEach { type ->
                                    FilterChip(
                                        selected = selectedType == type,
                                        onClick = { selectedType = type },
                                        label = { Text(type.name.replace("_", " ")) }
                                    )
                                }
                            }
                            OutlinedTextField(
                                value = nickname,
                                onValueChange = { nickname = it },
                                label = { Text("Nickname (Optional)") },
                                placeholder = { Text("e.g. Salary A/c") },
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(10.dp)
                            )
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                TextButton(onClick = { showAddForm = false }) { Text("Cancel") }
                                Button(
                                    onClick = {
                                        if (bankName.isNotBlank() && last4.length >= 3) {
                                            onAddAccount(bankName, last4, selectedType, nickname.ifBlank { null })
                                            bankName = ""
                                            last4 = ""
                                            nickname = ""
                                            showAddForm = false
                                        }
                                    },
                                    enabled = bankName.isNotBlank() && last4.length >= 3
                                ) {
                                    Text("Add")
                                }
                            }
                        }
                    }
                } else {
                    Button(
                        onClick = { showAddForm = true },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null)
                        Spacer(modifier = Modifier.padding(start = 4.dp))
                        Text("Add Account or Card")
                    }
                }

                if (accounts.isEmpty()) {
                    Text("No accounts registered yet.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                } else {
                    LazyColumn(modifier = Modifier.height(200.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(accounts) { acc ->
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(10.dp),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(10.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Default.CreditCard, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                                        Spacer(modifier = Modifier.padding(start = 8.dp))
                                        Column {
                                            Text("${acc.bankName} •••• ${acc.accountLast4}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                                            Text(acc.nickname ?: acc.accountType.name, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                                        }
                                    }
                                    IconButton(onClick = { accountPendingDeletion = acc }) {
                                        Icon(Icons.Default.Delete, contentDescription = "Delete", tint = CoralRed)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = onDismiss) { Text("Done") }
        }
    )

    accountPendingDeletion?.let { acc ->
        AlertDialog(
            onDismissRequest = { accountPendingDeletion = null },
            title = { Text("Remove this account?") },
            text = { Text("Removing \"${acc.bankName} •••• ${acc.accountLast4}\" means SpendTrack may no longer recognize self-transfers or card bill payments to it as non-expenses.") },
            confirmButton = {
                Button(
                    onClick = {
                        onDeleteAccount(acc.id)
                        accountPendingDeletion = null
                    },
                    colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = CoralRed)
                ) {
                    Text("Remove")
                }
            },
            dismissButton = {
                TextButton(onClick = { accountPendingDeletion = null }) { Text("Cancel") }
            }
        )
    }
}
