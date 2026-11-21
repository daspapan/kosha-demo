// Redemption forecast: plain arithmetic, shown in the UI with its formula. The model never forecasts.
export function rolling7dStats(dailyAmounts) {
  const sums = [];
  for (let i = 0; i + 7 <= dailyAmounts.length; i++) sums.push(dailyAmounts.slice(i, i + 7).reduce((a, b) => a + b, 0));
  const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
  const sd = Math.sqrt(sums.reduce((a, b) => a + (b - mean) ** 2, 0) / sums.length);
  return { days: dailyAmounts.length, windows: sums.length, mean: Math.round(mean), sd: Math.round(sd), max7d: Math.max(...sums),
    expected7d: Math.round((mean + 2 * sd) / 1000) * 1000, formula: "round((mean + 2 x sd of rolling 7-day sums) / 1000) x 1000" };
}
