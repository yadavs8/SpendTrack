package com.spendtrack.app.ui.screens.add

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
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
import com.spendtrack.app.core.model.PaymentMethod
import com.spendtrack.app.data.database.entity.CategoryEntity

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AddExpenseDialog(
    categories: List<CategoryEntity>,
    onDismiss: () -> Unit,
    onSave: (amount: Double, merchant: String, categoryId: String, method: PaymentMethod, notes: String?) -> Unit
) {
    var amountText by remember { mutableStateOf("") }
    var merchantText by remember { mutableStateOf("") }
    var notesText by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf(categories.firstOrNull()?.id ?: "cat_food") }
    var selectedCategoryName by remember { mutableStateOf(categories.firstOrNull()?.name ?: "Food & Dining") }
    var selectedMethod by remember { mutableStateOf(PaymentMethod.CASH) }
    var categoryDropdownExpanded by remember { mutableStateOf(false) }
    var attemptedSave by remember { mutableStateOf(false) }

    val parsedAmount = amountText.toDoubleOrNull()
    val isAmountValid = parsedAmount != null && parsedAmount > 0
    val isMerchantValid = merchantText.isNotBlank()
    val amountError = attemptedSave && !isAmountValid
    val merchantError = attemptedSave && !isMerchantValid

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = "Add Expense",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Amount Input
                OutlinedTextField(
                    value = amountText,
                    onValueChange = { amountText = it },
                    label = { Text("Amount (₹)") },
                    placeholder = { Text("0.00") },
                    prefix = { Text("₹ ") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    singleLine = true,
                    isError = amountError,
                    supportingText = if (amountError) {
                        { Text("Enter a valid amount greater than 0") }
                    } else null
                )

                // Merchant Input
                OutlinedTextField(
                    value = merchantText,
                    onValueChange = { merchantText = it },
                    label = { Text("Merchant / Paid To") },
                    placeholder = { Text("e.g. Swiggy, Chai Point, Grocery") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    singleLine = true,
                    isError = merchantError,
                    supportingText = if (merchantError) {
                        { Text("Merchant name is required") }
                    } else null
                )

                // Category Selector
                Box(modifier = Modifier.fillMaxWidth()) {
                    OutlinedTextField(
                        value = selectedCategoryName,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Category") },
                        trailingIcon = {
                            Icon(
                                Icons.Default.ArrowDropDown,
                                contentDescription = "Dropdown",
                                modifier = Modifier.clickable { categoryDropdownExpanded = true }
                            )
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { categoryDropdownExpanded = true },
                        shape = RoundedCornerShape(12.dp)
                    )

                    DropdownMenu(
                        expanded = categoryDropdownExpanded,
                        onDismissRequest = { categoryDropdownExpanded = false }
                    ) {
                        categories.forEach { category ->
                            DropdownMenuItem(
                                text = { Text(category.name) },
                                onClick = {
                                    selectedCategory = category.id
                                    selectedCategoryName = category.name
                                    categoryDropdownExpanded = false
                                }
                            )
                        }
                    }
                }

                // Payment Method Chips
                Text(
                    text = "Payment Method",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    PaymentMethod.values().forEach { method ->
                        FilterChip(
                            selected = selectedMethod == method,
                            onClick = { selectedMethod = method },
                            label = { Text(method.displayName) }
                        )
                    }
                }

                // Notes / Description
                OutlinedTextField(
                    value = notesText,
                    onValueChange = { notesText = it },
                    label = { Text("Notes (Optional)") },
                    placeholder = { Text("Lunch with team, etc.") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    attemptedSave = true
                    if (isAmountValid && isMerchantValid) {
                        onSave(
                            parsedAmount!!,
                            merchantText.trim(),
                            selectedCategory,
                            selectedMethod,
                            notesText.trim().ifEmpty { null }
                        )
                    }
                }
            ) {
                Text("Save Expense")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}
