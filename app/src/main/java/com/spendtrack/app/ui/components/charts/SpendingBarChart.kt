package com.spendtrack.app.ui.components.charts

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.spendtrack.app.core.utils.CurrencyUtils

data class DailyBarData(
    val dayLabel: String,
    val amount: Double,
    val isToday: Boolean = false
)

@Composable
fun SpendingBarChart(
    data: List<DailyBarData>,
    modifier: Modifier = Modifier,
    chartHeight: Dp = 130.dp,
    barColor: Color = MaterialTheme.colorScheme.primaryContainer,
    todayBarColor: Color = MaterialTheme.colorScheme.primary
) {
    val maxSpend = remember(data) {
        val max = data.maxOfOrNull { it.amount } ?: 1.0
        if (max <= 0.0) 1.0 else max
    }

    val animationProgress = remember { Animatable(0f) }

    LaunchedEffect(data) {
        animationProgress.snapTo(0f)
        animationProgress.animateTo(
            targetValue = 1f,
            animationSpec = tween(durationMillis = 700, easing = FastOutSlowInEasing)
        )
    }

    Column(modifier = modifier.fillMaxWidth()) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(chartHeight)
        ) {
            Canvas(modifier = Modifier.fillMaxWidth().height(chartHeight)) {
                val count = data.size
                if (count == 0) return@Canvas

                val availableWidth = size.width
                val barWidth = (availableWidth / count) * 0.45f
                val spacing = availableWidth / count
                val maxHeight = size.height - 10f

                // Draw subtle baseline
                drawLine(
                    color = Color.LightGray.copy(alpha = 0.4f),
                    start = Offset(0f, size.height),
                    end = Offset(size.width, size.height),
                    strokeWidth = 2f
                )

                data.forEachIndexed { index, item ->
                    val centerX = (index * spacing) + (spacing / 2f)
                    val rawBarHeight = ((item.amount / maxSpend).toFloat() * maxHeight).coerceAtLeast(8f)
                    val barHeight = rawBarHeight * animationProgress.value

                    val topLeft = Offset(
                        x = centerX - (barWidth / 2f),
                        y = size.height - barHeight
                    )

                    drawRoundRect(
                        color = if (item.isToday) todayBarColor else barColor,
                        topLeft = topLeft,
                        size = Size(barWidth, barHeight),
                        cornerRadius = CornerRadius(barWidth / 2f, barWidth / 2f)
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Day of week labels under bars
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceAround
        ) {
            data.forEach { item ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = item.dayLabel,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = if (item.isToday) FontWeight.Bold else FontWeight.Normal,
                        color = if (item.isToday) todayBarColor else MaterialTheme.colorScheme.outline
                    )
                    if (item.amount > 0) {
                        Text(
                            text = "₹${item.amount.toInt()}",
                            fontSize = 9.sp,
                            fontWeight = if (item.isToday) FontWeight.SemiBold else FontWeight.Normal,
                            color = if (item.isToday) todayBarColor else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}
