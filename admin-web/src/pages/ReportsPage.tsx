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
interface StockAgingLine {
  productId: string;
  skuCode: string;
  oldestAgeDays: number;
  quantityRemaining: string;
  value: string;
}
interface SupplierBalanceLine {
  supplierId: string;
  supplierName: string;
  totalAdvancesPaid: string;
  unappliedAdvance: string;
  openPoCount: number;
}
interface CustomerBalanceLine {
  customerId: string;
  customerName: string;
  bookedValue: string;
  received: string;
  outstanding: string;
}

function fmt(n: string | number) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function ReportsPage() {
  const { has } = useAuth();
  const financial = useFetch<FinancialSummary>(has("profit.view") ? "/reports/financial-summary" : null);
  const valuation = useFetch<InventoryValuation>(has("cost.view") ? "/reports/inventory-valuation" : null);
  const aging = useFetch<StockAgingLine[]>(has("stock.count") ? "/reports/stock-aging" : null);
  const supplierBalances = useFetch<SupplierBalanceLine[]>(
    has("supplier.payment_details.view") ? "/reports/supplier-balances" : null,
  );
  const customerBalances = useFetch<CustomerBalanceLine[]>(has("profit.view") ? "/reports/customer-balances" : null);

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

      {aging.data && aging.data.length > 0 && (
        <div className="panel">
          <h3>Stock aging</h3>
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Oldest layer (days)</th>
                <th>Remaining qty</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {aging.data.map((l) => (
                <tr key={l.productId}>
                  <td>{l.skuCode}</td>
                  <td>{l.oldestAgeDays}</td>
                  <td>{fmt(l.quantityRemaining)}</td>
                  <td>{fmt(l.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {supplierBalances.data && supplierBalances.data.length > 0 && (
        <div className="panel">
          <h3>Supplier balances</h3>
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Advances paid</th>
                <th>Unapplied advance</th>
                <th>Open POs with outstanding receipt</th>
              </tr>
            </thead>
            <tbody>
              {supplierBalances.data.map((s) => (
                <tr key={s.supplierId}>
                  <td>{s.supplierName}</td>
                  <td>{fmt(s.totalAdvancesPaid)}</td>
                  <td>{fmt(s.unappliedAdvance)}</td>
                  <td>{s.openPoCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {customerBalances.data && customerBalances.data.length > 0 && (
        <div className="panel">
          <h3>Customer balances</h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Booked value uses each line's unitPrice × quantity — not bundle-allocation-aware.
          </p>
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Booked value</th>
                <th>Received</th>
                <th>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {customerBalances.data.map((c) => (
                <tr key={c.customerId}>
                  <td>{c.customerName}</td>
                  <td>{fmt(c.bookedValue)}</td>
                  <td>{fmt(c.received)}</td>
                  <td>{fmt(c.outstanding)}</td>
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
