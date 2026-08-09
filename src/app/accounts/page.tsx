import { AccountManager } from "@/components/AccountManager";
import { formatCents } from "@/lib/money";
import { listAccounts, listPlaidItems, netWorthCents } from "@/lib/queries";
import { isPlaidConfigured, plaidEnvName } from "@/lib/plaid";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = listAccounts();
  const worth = netWorthCents();
  const banks = listPlaidItems();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Accounts</h1>
        <p className="text-xs text-muted">
          Net worth{" "}
          <span className="tnum font-medium text-text">
            {formatCents(worth.net)}
          </span>{" "}
          — {formatCents(worth.assets)} in assets less{" "}
          {formatCents(worth.liabilities)} owed
        </p>
      </div>

      <AccountManager
        accounts={accounts}
        banks={banks}
        plaidConfigured={isPlaidConfigured()}
        plaidEnvironment={plaidEnvName()}
      />
    </div>
  );
}
