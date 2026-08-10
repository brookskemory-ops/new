import { ForecastView } from "@/components/ForecastView";
import {
  buildForecast,
  detectIncomeChange,
  detectRecurring,
  savingsBalanceCents,
} from "@/lib/forecast";

export const dynamic = "force-dynamic";

export default async function ForecastPage() {
  const forecast = buildForecast();
  const series = detectRecurring();
  const incomeChange = detectIncomeChange();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Forecast</h1>
        <p className="text-xs text-muted">
          Everything else here reports the past. This is the part that looks
          forward — and it only counts charges it has actually watched repeat.
        </p>
      </div>

      <ForecastView
        forecast={forecast}
        savingsCents={savingsBalanceCents()}
        series={series}
        incomeChange={incomeChange}
      />
    </div>
  );
}
