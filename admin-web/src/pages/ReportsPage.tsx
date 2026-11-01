import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";

interface InventoryLine {
  productId: string;
  skuCode: string;
  quantityRemaining: string;
  value: string;
}
interface InventoryValuation {
  lines: InventoryLine[];
  totalValue: string;
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

function fmt(n: string | number) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function ReportsPage() {
  const { has } = useAuth();
  const financial = useFetch<FinancialSummary>(has("profit.view") ? "/reports/financial-summary" : null);
  const valuation = useFetch<InventoryValuation>(has("cost.view") ? "/reports/inventory-valuation" : null);

  return (
    <div>
      <h1>Reports</h1>

      {financial.data && (
        <div className="panel">
          <h3>Financial summary (all time, PKR)</h3>
          <table>
            <tbody>
              <tr><td>Gross sales</td><td>{fmt(financial.data.grossSales)}</td></tr>
              <tr><td>Net sales</td><td>{fmt(financial.data.netSales)}</td></tr>
              <tr><td>Cost of goods sold</td><td>{fmt(financial.data.cogs)}</td></tr>
              <tr><td><strong>Gross profit</strong></td><td><strong>{fmt(financial.data.grossProfit)}</strong></td></tr>
              <tr><td>Operating expenses</td><td>{fmt(financial.data.operatingExpenses)}</td></tr>
              <tr><td><strong>Operating result</strong></td><td><strong>{fmt(financial.data.operatingResult)}</strong></td></tr>
              <tr><td>Receivables outstanding</td><td>{fmt(financial.data.receivables)}</td></tr>
              <tr><td>Supplier advances outstanding</td><td>{fmt(financial.data.supplierAdvancesOutstanding)}</td></tr>
              <tr><td>Unsold inventory value</td><td>{fmt(financial.data.unsoldInventoryValue)}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {valuation.data && (
        <div className="panel">
          <h3>Inventory valuation by product</h3>
          <p>Total: {fmt(valuation.data.totalValue)} PKR</p>
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Remaining qty</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {valuation.data.lines.map((l) => (
                <tr key={l.productId}>
                  <td>{l.skuCode}</td>
                  <td>{fmt(l.quantityRemaining)}</td>
                  <td>{fmt(l.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!has("profit.view") && !has("cost.view") && <p style={{ color: "var(--text-muted)" }}>No reports are visible for your role.</p>}
    </div>
  );
}
