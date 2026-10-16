package com.spendtrack.app.ui.log

import android.content.Context
import android.content.Intent
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
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
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
        val tripOnly = intent.getBooleanExtra(ExpensePromptNotifier.EXTRA_TRIP_ONLY, false)
        val projectOnly = intent.getBooleanExtra(ExpensePromptNotifier.EXTRA_PROJECT_ONLY, false)
        val cashMode = transactionId == null && intent.action == ACTION_ADD_CASH
        if (transactionId == null && !cashMode) { finish(); return }

        setContent {
            SpendTrackTheme {
                var txn by remember { mutableStateOf<TransactionEntity?>(null) }
                var duplicateOf by remember { mutableStateOf<TransactionEntity?>(null) }
                var knownTrips by remember { mutableStateOf<List<String>>(emptyList()) }
                var knownProjects by remember { mutableStateOf<List<String>>(emptyList()) }
                var ready by remember { mutableStateOf(cashMode) }

                val settingsTrips by ServiceLocator.settingsManager.tripNamesFlow.collectAsState(initial = emptyList())
                val activeTrip by ServiceLocator.settingsManager.activeTripNameFlow.collectAsState(initial = null)
                val settingsProjects by ServiceLocator.settingsManager.projectNamesFlow.collectAsState(initial = emptyList())
                val activeProject by ServiceLocator.settingsManager.activeProjectNameFlow.collectAsState(initial = null)

                if (transactionId != null) {
                    LaunchedEffect(transactionId) {
                        val loaded = ServiceLocator.transactionRepository.getTransactionById(transactionId)
                        if (loaded == null) {
                            finish()
                            return@LaunchedEffect
                        }
                        // A "₹0" entry from an older version was never a payment: drop it, nothing to ask.
                        if (loaded.amount <= 0.0 && !loaded.isManuallyAdded) {
                            notPayment(loaded.id)
                            return@LaunchedEffect
                        }
                        txn = loaded
                        if (loaded.needsReview) duplicateOf = ServiceLocator.transactionRepository.duplicateCandidateFor(loaded)
                        // Refresh shared settings quickly so web trips and projects are included
                        kotlinx.coroutines.withTimeoutOrNull(1800) {
                            runCatching { ServiceLocator.cloudSyncRepository.refreshSharedSettings() }
                        }
                        val allTrips = ServiceLocator.transactionRepository.getAllKnownTrips()
                        val allProjects = ServiceLocator.transactionRepository.getAllKnownProjects()
                        knownTrips = allTrips
                        knownProjects = allProjects

                        // If the user clicked "✈️ Trips" on the notification and only 1 trip exists,
                        // save directly to that single trip without asking again!
                        if (tripOnly && allTrips.size == 1) {
                            ExpenseFiler.file(applicationContext, transactionId, ExpenseScope.TRIP, tripName = allTrips.single())
                            finish()
                            return@LaunchedEffect
                        }
                        // If the user clicked "🔨 Project" on the notification and only 1 project exists,
                        // save directly to that single project without asking again!
                        if (projectOnly && allProjects.size == 1) {
                            ExpenseFiler.file(applicationContext, transactionId, ExpenseScope.PROJECT, projectName = allProjects.single())
                            finish()
                            return@LaunchedEffect
                        }
                        ready = true
                    }
                }

                val mergedTrips = (knownTrips + settingsTrips).distinct()
                val mergedProjects = (knownProjects + settingsProjects).distinct()
                if (ready && (cashMode || txn != null)) {
                    LogSheet(
                        txn = txn,
                        trips = mergedTrips,
                        activeTrip = activeTrip,
                        tripOnly = tripOnly,
                        projects = mergedProjects,
                        activeProject = activeProject,
                        projectOnly = projectOnly,
                        duplicateOf = duplicateOf,
                        onSamePayment = { txn?.id?.let { samePayment(it) } },
                        onNotPayment = { txn?.id?.let { notPayment(it) } },
                        onDismiss = { finish() },
                        onChoose = { scope, trip, project, note, makeActiveTrip, makeActiveProject, cashAmount ->
                            choose(txn?.id, cashAmount, scope, trip, project, note, makeActiveTrip, makeActiveProject)
                        }
                    )
                }
            }
        }
    }

    private fun choose(
        transactionId: String?,
        cashAmount: Double?,
        scope: String,
        tripName: String?,
        projectName: String?,
        note: String?,
        makeActiveTrip: Boolean,
        makeActiveProject: Boolean
    ) {
        lifecycleScope.launch {
            if (makeActiveTrip && !tripName.isNullOrBlank()) {
                ServiceLocator.cloudSyncRepository.pushSharedSettings(ServiceLocator.settingsManager.setActiveTripName(tripName))
            }
            if (makeActiveProject && !projectName.isNullOrBlank()) {
                ServiceLocator.cloudSyncRepository.pushSharedSettings(ServiceLocator.settingsManager.setActiveProjectName(projectName))
            }
            val id = transactionId
                ?: ServiceLocator.transactionRepository.addCashExpense(cashAmount ?: return@launch, note)
            // A cash note is already its description; only pass it on for detected payments.
            ExpenseFiler.file(
                context = applicationContext,
                transactionId = id,
                scope = scope,
                tripName = tripName,
                projectName = projectName,
                note = if (transactionId != null) note else null
            )
            finish()
        }
    }

    /** "🚫 Not a payment": a chat or ₹0 message read as a spend. It stops counting and is not asked about again. */
    private fun notPayment(transactionId: String) {
        lifecycleScope.launch {
            com.spendtrack.app.core.nudge.NudgeScheduler.cancel(applicationContext, transactionId)
            ExpensePromptNotifier.dismiss(applicationContext, transactionId)
            ServiceLocator.transactionRepository.discardNotPayment(transactionId)
            runCatching { com.spendtrack.app.widget.KharchaWidget.refresh(applicationContext) }
            ServiceLocator.cloudSyncRepository.syncPending()
            finish()
        }
    }

    /** "✅ Same payment": a second message about a payment already logged; count it once. */
    private fun samePayment(transactionId: String) {
        lifecycleScope.launch {
            com.spendtrack.app.core.nudge.NudgeScheduler.cancel(applicationContext, transactionId)
            ExpensePromptNotifier.dismiss(applicationContext, transactionId)
            val kept = ServiceLocator.transactionRepository.confirmDuplicate(transactionId)
            if (kept != null) ExpensePromptNotifier.showMerged(applicationContext, kept)
            runCatching { com.spendtrack.app.widget.KharchaWidget.refresh(applicationContext) }
            ServiceLocator.cloudSyncRepository.syncPending()
            finish()
        }
    }

    companion object {
        const val ACTION_ADD_CASH = "com.spendtrack.app.ADD_CASH"

        fun cashIntent(context: Context): Intent =
            Intent(context, LogExpenseActivity::class.java).apply {
                action = ACTION_ADD_CASH
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LogSheet(
    txn: TransactionEntity?,
    trips: List<String>,
    activeTrip: String?,
    tripOnly: Boolean = false,
    projects: List<String> = emptyList(),
    activeProject: String? = null,
    projectOnly: Boolean = false,
    duplicateOf: TransactionEntity? = null,
    onSamePayment: () -> Unit = {},
    onNotPayment: () -> Unit = {},
    onDismiss: () -> Unit,
    onChoose: (scope: String, trip: String?, project: String?, note: String?, makeActiveTrip: Boolean, makeActiveProject: Boolean, cashAmount: Double?) -> Unit
) {
    val cashMode = txn == null
    var amountText by remember { mutableStateOf("") }
    val cashAmount = amountText.replace(",", "").toDoubleOrNull()?.takeIf { it > 0 && it < 1e8 }
    var note by remember { mutableStateOf("") }
    var newTrip by remember { mutableStateOf("") }
    var makeActiveTrip by remember { mutableStateOf(false) }
    var newProject by remember { mutableStateOf("") }
    var makeActiveProject by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val amountFocus = remember { FocusRequester() }
    val canPick = !busy && (!cashMode || cashAmount != null)

    fun pick(
        s: String,
        trip: String? = null,
        project: String? = null,
        activeTripFlag: Boolean = false,
        activeProjectFlag: Boolean = false
    ) {
        if (!canPick) return
        busy = true
        scope.launch {
            onChoose(
                s,
                trip,
                project,
                note.takeIf { it.isNotBlank() },
                activeTripFlag,
                activeProjectFlag,
                cashAmount
            )
        }
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
                if (txn != null) {
                    val merchant = txn.merchantName?.takeIf { it.isNotBlank() }
                    Text(
                        text = ExpensePromptNotifier.amountLabel(txn.amount) + (merchant?.let { " at $it" } ?: ""),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = when {
                            tripOnly && trips.size > 1 -> "${ExpensePromptNotifier.whenLabel(txn.dateTime)} · Which trip should this go to?"
                            projectOnly && projects.size > 1 -> "${ExpensePromptNotifier.whenLabel(txn.dateTime)} · Which project / function should this go to?"
                            else -> ExpensePromptNotifier.whenLabel(txn.dateTime) +
                                if (!txn.needsReview) " · already logged, choose again to move it" else ""
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                    if (duplicateOf != null) {
                        val earlierMerchant = duplicateOf.merchantName
                            ?.takeIf { it.isNotBlank() && !it.equals("Unknown Merchant", ignoreCase = true) }
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.secondaryContainer,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    "Looks like the ${ExpensePromptNotifier.amountLabel(duplicateOf.amount)}" +
                                        (earlierMerchant?.let { " at $it" } ?: "") +
                                        " already logged on ${ExpensePromptNotifier.whenLabel(duplicateOf.dateTime)}.",
                                    style = MaterialTheme.typography.bodyMedium
                                )
                                Button(onClick = { if (!busy) { busy = true; onSamePayment() } }, enabled = !busy) {
                                    Text("✅ Same payment, count it once")
                                }
                                Text(
                                    "A different payment? Choose where it goes below.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.outline
                                )
                            }
                        }
                    }
                } else {
                    Text("💵 Cash spend", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    OutlinedTextField(
                        value = amountText,
                        onValueChange = { v -> amountText = v.filter { it.isDigit() || it == '.' || it == ',' }.take(10) },
                        label = { Text("Amount (₹)") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth().focusRequester(amountFocus)
                    )
                    LaunchedEffect(Unit) { runCatching { amountFocus.requestFocus() } }
                }

                if (tripOnly && trips.isNotEmpty()) {
                    Text("✈️ Select Trip", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        trips.forEach { trip ->
                            val label = if (trip == activeTrip) "✈️ $trip (active)" else "✈️ $trip"
                            Button(onClick = { pick(ExpenseScope.TRIP, trip = trip) }, enabled = canPick) { Text(label) }
                        }
                    }
                }

                if (projectOnly && projects.isNotEmpty()) {
                    Text("🔨 Select Project / Function", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        projects.forEach { proj ->
                            val label = if (proj == activeProject) "🔨 $proj (active)" else "🔨 $proj"
                            Button(onClick = { pick(ExpenseScope.PROJECT, project = proj) }, enabled = canPick) { Text(label) }
                        }
                    }
                }

                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it.take(50) },
                    label = { Text(if (cashMode) "What was it? (e.g. Milk, Auto)" else "What was it? (optional, e.g. Milk)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                if (!tripOnly && !projectOnly) {
                    Text("Log to", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.outline)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(onClick = { pick(ExpenseScope.PERSONAL) }, enabled = canPick) { Text("👤 Personal") }
                        FilledTonalButton(onClick = { pick(ExpenseScope.FAMILY) }, enabled = canPick) { Text("🏠 Family") }
                        FilledTonalButton(onClick = { pick(ExpenseScope.INVESTMENT) }, enabled = canPick) { Text("📈 Investment") }
                        FilledTonalButton(
                            onClick = {
                                val proj = activeProject ?: projects.singleOrNull()
                                pick(ExpenseScope.PROJECT, project = proj)
                            },
                            enabled = canPick
                        ) {
                            Text(if (!activeProject.isNullOrBlank()) "🔨 $activeProject" else "🔨 Project")
                        }
                        if (!cashMode) FilledTonalButton(onClick = { pick(ExpenseScope.TRANSFER) }, enabled = canPick) { Text("🔁 Own transfer") }
                    }

                    if (trips.isNotEmpty()) {
                        Text("Trips", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.outline)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            trips.forEach { trip ->
                                val label = if (trip == activeTrip) "✈️ $trip (active)" else "✈️ $trip"
                                if (trip == activeTrip) {
                                    Button(onClick = { pick(ExpenseScope.TRIP, trip = trip) }, enabled = canPick) { Text(label) }
                                } else {
                                    OutlinedButton(onClick = { pick(ExpenseScope.TRIP, trip = trip) }, enabled = canPick) { Text(label) }
                                }
                            }
                        }
                    }

                    if (projects.isNotEmpty()) {
                        Text("Projects & Functions", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.outline)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            projects.forEach { proj ->
                                val label = if (proj == activeProject) "🔨 $proj (active)" else "🔨 $proj"
                                if (proj == activeProject) {
                                    Button(onClick = { pick(ExpenseScope.PROJECT, project = proj) }, enabled = canPick) { Text(label) }
                                } else {
                                    OutlinedButton(onClick = { pick(ExpenseScope.PROJECT, project = proj) }, enabled = canPick) { Text(label) }
                                }
                            }
                        }
                    }
                }

                if (!projectOnly) {
                    Text("New trip", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.outline)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = newTrip,
                            onValueChange = { newTrip = it.take(30) },
                            label = { Text("e.g. Manali Trip") },
                            singleLine = true,
                            modifier = Modifier.weight(1f)
                        )
                        Button(
                            onClick = { pick(ExpenseScope.TRIP, trip = newTrip.trim(), activeTripFlag = makeActiveTrip) },
                            enabled = canPick && newTrip.isNotBlank()
                        ) { Text("Log") }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = makeActiveTrip, onCheckedChange = { makeActiveTrip = it })
                        Text("Make it the active trip", style = MaterialTheme.typography.bodyMedium)
                    }
                }

                if (!tripOnly) {
                    Text("New project / function", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.outline)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = newProject,
                            onValueChange = { newProject = it.take(30) },
                            label = { Text("e.g. Family Function") },
                            singleLine = true,
                            modifier = Modifier.weight(1f)
                        )
                        Button(
                            onClick = { pick(ExpenseScope.PROJECT, project = newProject.trim(), activeProjectFlag = makeActiveProject) },
                            enabled = canPick && newProject.isNotBlank()
                        ) { Text("Log") }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = makeActiveProject, onCheckedChange = { makeActiveProject = it })
                        Text("Make it the active project", style = MaterialTheme.typography.bodyMedium)
                    }
                }

                Spacer(Modifier.height(4.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = if (cashMode) Arrangement.End else Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (!cashMode) {
                        TextButton(onClick = { if (!busy) { busy = true; onNotPayment() } }, enabled = !busy) {
                            Text("🚫 Not a payment", color = MaterialTheme.colorScheme.error)
                        }
                    }
                    TextButton(onClick = onDismiss) { Text("Later") }
                }
            }
        }
    }
}
