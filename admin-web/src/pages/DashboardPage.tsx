import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";

interface StockSummaryLine {
  state: string;
  onHandQty: string;
  reservedQty: string;
  availableQty: string | null;
}

interface FinancialSummary {
  grossSales: string;
  netSales: string;
  cogs: string;
  grossProfit: string;
  operatingExpenses: string;
  operatingResult: string;
  receivables: string;
  supplierAdvancesOutstanding: string;
  unsoldInventoryValue: string;
}

function fmt(n: string | number | undefined) {
  if (n === undefined) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function DashboardPage() {
  const { has } = useAuth();
  const stock = useFetch<StockSummaryLine[]>(has("stock.count") ? "/reports/stock-summary" : null);
  const pendingReceipts = useFetch<unknown[]>(has("stock.receive") ? "/reports/pending-receipts" : null);
  const unfulfilled = useFetch<unknown[]>(has("order.pick") ? "/reports/unfulfilled-orders" : null);
  const pendingReturns = useFetch<unknown[]>(has("return.process") ? "/reports/pending-returns" : null);
  const financial = useFetch<FinancialSummary>(has("profit.view") ? "/reports/financial-summary" : null);

  const saleable = stock.data?.find((s) => s.state === "saleable");

  return (
    <div>
      <h1>Dashboard</h1>

      <h3>Operational</h3>
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {saleable && (
          <>
            <div className="stat-tile">
              <div className="value">{fmt(saleable.onHandQty)}</div>
              <div className="label">Saleable on-hand</div>
            </div>
            <div className="stat-tile">
              <div className="value">{fmt(saleable.availableQty ?? undefined)}</div>
              <div className="label">Available to sell</div>
            </div>
          </>
        )}
        {pendingReceipts.data && (
          <div className="stat-tile">
            <div className="value">{pendingReceipts.data.length}</div>
            <div className="label">POs with outstanding receipt</div>
          </div>
        )}
        {unfulfilled.data && (
          <div className="stat-tile">
            <div className="value">{unfulfilled.data.length}</div>
            <div className="label">Unfulfilled orders</div>
          </div>
        )}
        {pendingReturns.data && (
          <div className="stat-tile">
            <div className="value">{pendingReturns.data.length}</div>
            <div className="label">Pending returns</div>
          </div>
        )}
      </div>

      {stock.data && (
        <div className="panel">
          <h3>Stock by state</h3>
          <table>
            <thead>
              <tr>
                <th>State</th>
                <th>On hand</th>
                <th>Reserved</th>
                <th>Available</th>
              </tr>
            </thead>
            <tbody>
              {stock.data.map((s) => (
                <tr key={s.state}>
                  <td>{s.state}</td>
                  <td>{fmt(s.onHandQty)}</td>
                  <td>{fmt(s.reservedQty)}</td>
                  <td>{s.availableQty === null ? "—" : fmt(s.availableQty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {financial.data && (
        <>
          <h3>Financial (all time)</h3>
          <div className="stat-grid">
            <div className="stat-tile">
              <div className="value">{fmt(financial.data.netSales)}</div>
              <div className="label">Net sales (PKR)</div>
            </div>
            <div className="stat-tile">
              <div className="value">{fmt(financial.data.grossProfit)}</div>
              <div className="label">Gross profit</div>
            </div>
            <div className="stat-tile">
              <div className="value">{fmt(financial.data.operatingResult)}</div>
              <div className="label">Operating result</div>
            </div>
            <div className="stat-tile">
              <div className="value">{fmt(financial.data.receivables)}</div>
              <div className="label">Receivables</div>
            </div>
            <div className="stat-tile">
              <div className="value">{fmt(financial.data.unsoldInventoryValue)}</div>
              <div className="label">Unsold inventory value</div>
            </div>
          </div>
        </>
      )}

      {!has("stock.count") && !has("profit.view") && (
        <p style={{ color: "var(--text-muted)" }}>No dashboard widgets are visible for your role.</p>
      )}
    </div>
  );
}
