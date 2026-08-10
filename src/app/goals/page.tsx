import { GoalsManager } from "@/components/GoalsManager";
import { listGoals } from "@/lib/queries";
import { monthlyTrend } from "@/lib/queries";
import { currentMonth } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const goals = listGoals();

  // Typical monthly saving, from what actually happened rather than intent.
  // The median of positive months: one windfall shouldn't promise a date you
  // will never hit, and one bad month shouldn't say never.
  const nets = monthlyTrend(currentMonth(), 6)
    .map((month) => month.net_cents)
    .filter((net) => net > 0)
    .sort((a, b) => a - b);
  const typicalMonthlySaving =
    nets.length > 0 ? nets[Math.floor(nets.length / 2)] : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title">Goals</h1>
        <p className="text-xs text-muted">
          What you are saving toward, and when you will get there at your
          current rate.
        </p>
      </div>

      <GoalsManager goals={goals} typicalMonthlySaving={typicalMonthlySaving} />
    </div>
  );
}
