package com.spendtrack.app.ui.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.Preferences
import com.spendtrack.app.data.datastore.SettingsManager
import com.spendtrack.app.data.di.ServiceLocator
import kotlinx.coroutines.launch

/** Settings → Automations: one switch per automation, plus who counts as "family reimbursing you". */
@Composable
fun AutomationsCard() {
    val settings = ServiceLocator.settingsManager
    val scope = rememberCoroutineScope()
    val familyPayers by settings.familyPayersFlow.collectAsState(initial = "")
    var familyInput by remember(familyPayers) { mutableStateOf(familyPayers) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Automations", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(
                "Kharcha Book does these on its own. Each reminder fires once per occasion.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline
            )
            Toggle(SettingsManager.KEY_AUTO_INCOME, "Log income automatically",
                "Salary, UPI received, interest and cashback from bank SMS go to Incomings. Refunds reduce the original expense.")
            Toggle(SettingsManager.KEY_BUDGET_ALERTS, "Budget alerts",
                "At 80% and 100% of your monthly and category budgets (set in Kharcha Book).")
            Toggle(SettingsManager.KEY_BILL_REMINDERS, "Bill & card due reminders",
                "Credit card due dates from statement SMS (3 days, 1 day and on the day), and recurring bills before they're due.")
            Toggle(SettingsManager.KEY_CASH_NUDGE, "Cash spend nudge",
                "After an ATM withdrawal, an evening reminder to log cash spends.")
            Toggle(SettingsManager.KEY_SETTLE_NUDGE, "Monthly family settle-up",
                "On the 1st, last month's family share with a ready WhatsApp message.")
            Toggle(SettingsManager.KEY_WEEKLY_SUMMARY, "Weekly summary",
                "Sunday evening: this week's spend vs last week and the top category.")

            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
            Text("Family who reimburse you", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Text(
                "Full names or UPI IDs, comma separated. Money from them is logged as \"👵 Withdrawn from Mother\" and settles family expenses.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline
            )
            OutlinedTextField(
                value = familyInput,
                onValueChange = { familyInput = it },
                placeholder = { Text("e.g. Mamta Kasyap, mamta@oksbi") },
                modifier = Modifier.fillMaxWidth()
            )
            Button(
                onClick = {
                    scope.launch {
                        val doc = settings.setFamilyPayers(familyInput)
                        ServiceLocator.cloudSyncRepository.pushSharedSettings(doc)
                    }
                },
                enabled = familyInput.trim() != familyPayers.trim(),
                modifier = Modifier.align(Alignment.End)
            ) { Text("Save") }
        }
    }
}

@Composable
private fun Toggle(key: Preferences.Key<Boolean>, title: String, subtitle: String) {
    val settings = ServiceLocator.settingsManager
    val scope = rememberCoroutineScope()
    val on by settings.automationFlow(key).collectAsState(initial = true)
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        }
        Switch(checked = on, onCheckedChange = { v -> scope.launch { settings.setAutomation(key, v) } })
    }
}
