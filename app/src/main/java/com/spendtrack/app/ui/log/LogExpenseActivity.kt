package com.spendtrack.app.ui.log

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.spendtrack.app.core.model.ExpenseScope
import com.spendtrack.app.core.notification.ExpenseFiler
import com.spendtrack.app.core.notification.ExpensePromptNotifier
import com.spendtrack.app.data.database.entity.TransactionEntity
import com.spendtrack.app.data.di.ServiceLocator
import com.spendtrack.app.ui.theme.SpendTrackTheme
import kotlinx.coroutines.launch

/**
 * "Log to…" sheet for one auto-detected expense: every destination in one place -- Personal,
 * Family, Investment, Project, any trip (including one started late, e.g. the fuel bought before
 * leaving town), a brand-new trip, plus an optional note. Opens over whatever app the user is in.
 */
class LogExpenseActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ServiceLocator.init(applicationContext)
        val transactionId = intent.getStringExtra(ExpensePromptNotifier.EXTRA_TRANSACTION_ID)
        if (transactionId == null) { finish(); return }

        // Trips may have been created on the web since the phone last looked.
        lifecycleScope.launch { runCatching { ServiceLocator.cloudSyncRepository.refreshSharedSettings() } }

        setContent {
            SpendTrackTheme {
                var txn by remember { mutableStateOf<TransactionEntity?>(null) }
                LaunchedEffect(transactionId) {
                    txn = ServiceLocator.transactionRepository.getTransactionById(transactionId)
                    if (txn == null) finish()
                }
                val trips by ServiceLocator.settingsManager.tripNamesFlow.collectAsState(initial = emptyList())
                val activeTrip by ServiceLocator.settingsManager.activeTripNameFlow.collectAsState(initial = null)
                txn?.let { t ->
                    LogSheet(
                        txn = t,
                        trips = trips,
                        activeTrip = activeTrip,
                        onDismiss = { finish() },
                        onChoose = { scope, trip, note, makeActive -> choose(t.id, scope, trip, note, makeActive) }
                    )
                }
            }
        }
    }

    private fun choose(transactionId: String, scope: String, tripName: String?, note: String?, makeActiveTrip: Boolean) {
        lifecycleScope.launch {
            if (makeActiveTrip && !tripName.isNullOrBlank()) {
                ServiceLocator.cloudSyncRepository.pushSharedSettings(ServiceLocator.settingsManager.setActiveTripName(tripName))
            }
            ExpenseFiler.file(applicationContext, transactionId, scope, tripName, note)
            finish()
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LogSheet(
    txn: TransactionEntity,
    trips: List<String>,
    activeTrip: String?,
    onDismiss: () -> Unit,
    onChoose: (scope: String, trip: String?, note: String?, makeActive: Boolean) -> Unit
) {
    var note by remember { mutableStateOf("") }
    var newTrip by remember { mutableStateOf("") }
    var makeActive by remember { mutableStateOf(activeTrip == null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun pick(s: String, trip: String? = null, active: Boolean = false) {
        if (busy) return
        busy = true
        scope.launch { onChoose(s, trip, note.takeIf { it.isNotBlank() }, active) }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0x99000000))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { onDismiss() },
        contentAlignment = Alignment.BottomCenter
    ) {
        Surface(
            shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
            color = MaterialTheme.colorScheme.surface,
            modifier = Modifier
                .fillMaxWidth()
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { }
                .imePadding()
        ) {
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp)
                    .navigationBarsPadding(),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                val merchant = txn.merchantName?.takeIf { it.isNotBlank() }
                Text(
                    text = ExpensePromptNotifier.amountLabel(txn.amount) + (merchant?.let { " at $it" } ?: ""),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = ExpensePromptNotifier.whenLabel(txn.dateTime) +
                        if (!txn.needsReview) " · already logged, choose again to move it" else "",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )

                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it.take(50) },
                    label = { Text("What was it? (optional, e.g. Milk)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                Text("Log to", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.outline)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilledTonalButton(onClick = { pick(ExpenseScope.PERSONAL) }, enabled = !busy) { Text("👤 Personal") }
                    FilledTonalButton(onClick = { pick(ExpenseScope.FAMILY) }, enabled = !busy) { Text("🏠 Family") }
                    FilledTonalButton(onClick = { pick(ExpenseScope.INVESTMENT) }, enabled = !busy) { Text("📈 Investment") }
                    FilledTonalButton(onClick = { pick(ExpenseScope.PROJECT) }, enabled = !busy) { Text("🔨 Project") }
                }

                if (trips.isNotEmpty()) {
                    Text("Trips", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.outline)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        trips.forEach { trip ->
                            val label = if (trip == activeTrip) "✈️ $trip (active)" else "✈️ $trip"
                            if (trip == activeTrip) {
                                Button(onClick = { pick(ExpenseScope.TRIP, trip) }, enabled = !busy) { Text(label) }
                            } else {
                                OutlinedButton(onClick = { pick(ExpenseScope.TRIP, trip) }, enabled = !busy) { Text(label) }
                            }
                        }
                    }
                }

                Text("New trip", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.outline)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = newTrip,
                        onValueChange = { newTrip = it.take(30) },
                        label = { Text("e.g. Goa") },
                        singleLine = true,
                        modifier = Modifier.weight(1f)
                    )
                    Button(
                        onClick = { pick(ExpenseScope.TRIP, newTrip.trim(), makeActive) },
                        enabled = !busy && newTrip.isNotBlank()
                    ) { Text("Log") }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = makeActive, onCheckedChange = { makeActive = it })
                    Text("Make it the active trip", style = MaterialTheme.typography.bodyMedium)
                }

                Spacer(Modifier.height(4.dp))
                TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End)) { Text("Later") }
            }
        }
    }
}
