package com.spendtrack.app.ui.components.charts

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.spendtrack.app.core.utils.CurrencyUtils
import kotlin.math.atan2

data class ChartSlice(
    val id: String,
    val name: String,
    val amount: Double,
    val color: Color
)

@Composable
fun DonutChart(
    slices: List<ChartSlice>,
    totalAmount: Double,
    modifier: Modifier = Modifier,
    chartSize: Dp = 200.dp,
    strokeWidth: Dp = 26.dp
) {
    var selectedSlice by remember { mutableStateOf<ChartSlice?>(null) }
    val animationProgress = remember { Animatable(0f) }

    LaunchedEffect(slices) {
        animationProgress.snapTo(0f)
        animationProgress.animateTo(
            targetValue = 1f,
            animationSpec = tween(durationMillis = 800, easing = FastOutSlowInEasing)
        )
    }

    Box(
        modifier = modifier.size(chartSize),
        contentAlignment = Alignment.Center
    ) {
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(slices, totalAmount) {
                    detectTapGestures { tapOffset ->
                        val center = Offset(size.width / 2f, size.height / 2f)
                        val dx = tapOffset.x - center.x
                        val dy = tapOffset.y - center.y
                        var angle = Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat()
                        if (angle < 0) angle += 360f

                        // Adjust for starting angle (-90 degrees / top)
                        var adjustedAngle = (angle + 90f) % 360f

                        if (totalAmount > 0) {
                            var currentAngle = 0f
                            for (slice in slices) {
                                val sweep = (slice.amount / totalAmount).toFloat() * 360f
                                if (adjustedAngle in currentAngle..(currentAngle + sweep)) {
                                    selectedSlice = if (selectedSlice == slice) null else slice
                                    break
                                }
                                currentAngle += sweep
                            }
                        }
                    }
                }
        ) {
            val strokePx = strokeWidth.toPx()
            val canvasSize = size.minDimension
            val radius = (canvasSize - strokePx) / 2f
            val topLeft = Offset((size.width - radius * 2) / 2f, (size.height - radius * 2) / 2f)
            val arcSize = Size(radius * 2, radius * 2)

            if (slices.isEmpty() || totalAmount <= 0.0) {
                // Empty state ring
                drawArc(
                    color = Color.LightGray.copy(alpha = 0.3f),
                    startAngle = 0f,
                    sweepAngle = 360f,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = strokePx)
                )
            } else {
                var startAngle = -90f
                val totalSweep = 360f * animationProgress.value

                slices.forEach { slice ->
                    val rawSweep = (slice.amount / totalAmount).toFloat() * 360f
                    val sweep = (rawSweep * animationProgress.value).coerceAtLeast(1f)
                    val isSelected = selectedSlice == slice

                    drawArc(
                        color = if (selectedSlice == null || isSelected) slice.color else slice.color.copy(alpha = 0.35f),
                        startAngle = startAngle,
                        sweepAngle = sweep - (if (slices.size > 1) 2.5f else 0f),
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = Stroke(
                            width = if (isSelected) strokePx * 1.25f else strokePx,
                            cap = StrokeCap.Round
                        )
                    )
                    startAngle += rawSweep
                }
            }
        }

        // Center Info Text
        Column(
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (selectedSlice != null) {
                Text(
                    text = selectedSlice!!.name,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline,
                    maxLines = 1
                )
                Text(
                    text = CurrencyUtils.formatRupees(selectedSlice!!.amount),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = selectedSlice!!.color
                )
                val pct = ((selectedSlice!!.amount / totalAmount) * 100).toInt()
                Text(
                    text = "$pct%",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                Text(
                    text = "Total Spent",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
                Text(
                    text = CurrencyUtils.formatRupees(totalAmount),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
        }
    }
}
