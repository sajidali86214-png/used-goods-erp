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

interface CategoryInventoryLine {
  categoryId: string;
  categoryName: string;
  quantityRemaining: string;
  value: string;
  contributionPct: string;
}
interface CategoryInventory {
  lines: CategoryInventoryLine[];
  totalValue: string;
}

interface CustomerBalance {
  bookedValue: string;
  received: string;
  outstanding: string;
}
interface SupplierBalance {
  totalAdvancesPaid: string;
  unappliedAdvance: string;
  openPoCount: number;
}
interface PaidButUnreceivedPurchase {
  poId: string;
  poNumber: string;
  supplierName: string;
  totalAdvance: string;
  outstandingQty: string;
}
type FulfilmentSummary = Record<string, number>;

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
  const categoryInventory = useFetch<CategoryInventory>(has("cost.view") ? "/reports/inventory-by-category" : null);
  const customerBalances = useFetch<CustomerBalance[]>(has("profit.view") ? "/reports/customer-balances" : null);
  const supplierBalances = useFetch<SupplierBalance[]>(
    has("supplier.payment_details.view") ? "/reports/supplier-balances" : null,
  );
  const paidUnreceived = useFetch<PaidButUnreceivedPurchase[]>(
    has("stock.receive") ? "/reports/paid-but-unreceived-purchases" : null,
  );
  const fulfilmentSummary = useFetch<FulfilmentSummary>(has("order.pick") ? "/reports/fulfilment-summary" : null);
  const pendingRefunds = useFetch<unknown[]>(has("refund.create") ? "/reports/pending-refunds" : null);

  const saleable = stock.data?.find((s) => s.state === "saleable");
  const cashReceived = customerBalances.data?.reduce((sum, c) => sum + Number(c.received), 0);
  const supplierOutstanding = supplierBalances.data?.reduce((sum, s) => sum + Number(s.unappliedAdvance), 0);
  const dispatchedOrDelivered =
    fulfilmentSummary.data &&
    Object.entries(fulfilmentSummary.data)
      .filter(([status]) => ["dispatched", "delivered", "partially_dispatched", "partially_delivered"].includes(status))
      .reduce((sum, [, count]) => sum + count, 0);

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
            <div className="stat-tile">
              <div className="value">{fmt(saleable.reservedQty)}</div>
              <div className="label">Booked (reserved for orders)</div>
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
        {pendingRefunds.data && (
          <div className="stat-tile">
            <div className="value">{pendingRefunds.data.length}</div>
            <div className="label">Pending refunds</div>
          </div>
        )}
        {paidUnreceived.data && (
          <div
            className="stat-tile"
            title="Purchase orders where a supplier advance has been paid but stock is still outstanding on at least one line."
          >
            <div className="value">{paidUnreceived.data.length}</div>
            <div className="label">Paid but unreceived purchases</div>
          </div>
        )}
        {dispatchedOrDelivered !== undefined && (
          <div className="stat-tile" title="Orders currently dispatched or delivered (fully or partially).">
            <div className="value">{dispatchedOrDelivered}</div>
            <div className="label">Dispatched / delivered orders</div>
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
            <div className="stat-tile" title="Posted operating expenses (salaries, commuting, fuel, rent, courier, packaging, etc.) — included in operating result above.">
              <div className="value">{fmt(financial.data.operatingExpenses)}</div>
              <div className="label">Operating expenses</div>
            </div>
            <div className="stat-tile" title="What customers still owe across all their orders — booked order value minus what they've actually paid. Not a ledger balance.">
              <div className="value">{fmt(financial.data.receivables)}</div>
              <div className="label">Receivables (customers owe you)</div>
            </div>
            {cashReceived !== undefined && (
              <div className="stat-tile" title="Total real payments received from customers across all orders, regardless of whether those orders have dispatched yet.">
                <div className="value">{fmt(cashReceived)}</div>
                <div className="label">Cash received from customers</div>
              </div>
            )}
            <div className="stat-tile" title="Advances paid to suppliers that haven't yet been matched against a supplier invoice.">
              <div className="value">{fmt(financial.data.supplierAdvancesOutstanding)}</div>
              <div className="label">Supplier advances outstanding</div>
            </div>
            {supplierOutstanding !== undefined && (
              <div className="stat-tile" title="Across suppliers with an open balance: unapplied advances paid out.">
                <div className="value">{fmt(supplierOutstanding)}</div>
                <div className="label">Supplier balances (unapplied)</div>
              </div>
            )}
            <div className="stat-tile">
              <div className="value">{fmt(financial.data.unsoldInventoryValue)}</div>
              <div className="label">Unsold inventory value</div>
            </div>
          </div>
        </>
      )}

      {categoryInventory.data && categoryInventory.data.lines.length > 0 && (
        <div className="panel">
          <h3>Inventory value by category</h3>
          <p>Total: {fmt(categoryInventory.data.totalValue)} PKR</p>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Qty remaining</th>
                <th>Value (PKR)</th>
                <th>% of total</th>
              </tr>
            </thead>
            <tbody>
              {categoryInventory.data.lines.map((l) => (
                <tr key={l.categoryId}>
                  <td>{l.categoryName}</td>
                  <td>{fmt(l.quantityRemaining)}</td>
                  <td>{fmt(l.value)}</td>
                  <td>{Number(l.contributionPct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!has("stock.count") && !has("profit.view") && (
        <p style={{ color: "var(--text-muted)" }}>No dashboard widgets are visible for your role.</p>
      )}
    </div>
  );
}
