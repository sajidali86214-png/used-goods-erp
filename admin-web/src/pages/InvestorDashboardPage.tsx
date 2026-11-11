import { useState } from "react";
import { useFetch } from "../api/useFetch";

interface ExpenseCategoryLine {
  categoryId: string;
  label: string;
  total: string;
}
interface Profitability {
  grossSales: string;
  netSales: string;
  cogs: string;
  grossProfit: string;
  operatingExpenses: string;
  operatingResult: string;
}
interface InvestorDashboard {
  investor: { id: string; name: string; profitSharePercent: string };
  periodFrom: string | null;
  periodTo: string | null;
  profitability: Profitability;
  profitShareAmount: string;
  currentInventoryValue: string;
  expensesByCategory: ExpenseCategoryLine[];
  totalExpenses: string;
}

function fmt(n: string | number) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function InvestorDashboardPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const query = [from && `from=${from}`, to && `to=${to}`].filter(Boolean).join("&");
  const dashboard = useFetch<InvestorDashboard>(`/investor/dashboard${query ? `?${query}` : ""}`, [from, to]);

  return (
    <div>
      <h1>Investor Dashboard</h1>

      <div className="panel">
        <h3>Reporting period</h3>
        <div className="form-row">
          <div className="field">
            <label>From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Leave both blank for all-time figures. All numbers below reflect only posted records, in PKR.</p>
      </div>

      {dashboard.loading && <p>Loading...</p>}
      {dashboard.error && <div className="error-banner">{dashboard.error}</div>}

      {dashboard.data && (
        <>
          <div className="panel">
            <h3>Your share</h3>
            <table>
              <tbody>
                <tr>
                  <td>Investor</td>
                  <td>{dashboard.data.investor.name}</td>
                </tr>
                <tr>
                  <td>Agreed profit share</td>
                  <td>{Number(dashboard.data.investor.profitSharePercent)}%</td>
                </tr>
                <tr>
                  <td>
                    <strong>Your calculated amount</strong>
                  </td>
                  <td>
                    <strong>{fmt(dashboard.data.profitShareAmount)} PKR</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3>Profitability for the period</h3>
            <table>
              <tbody>
                <tr><td>Gross sales</td><td>{fmt(dashboard.data.profitability.grossSales)}</td></tr>
                <tr><td>Net sales</td><td>{fmt(dashboard.data.profitability.netSales)}</td></tr>
                <tr><td>Cost of goods sold</td><td>{fmt(dashboard.data.profitability.cogs)}</td></tr>
                <tr><td><strong>Gross profit</strong></td><td><strong>{fmt(dashboard.data.profitability.grossProfit)}</strong></td></tr>
                <tr><td>Operating expenses</td><td>{fmt(dashboard.data.profitability.operatingExpenses)}</td></tr>
                <tr><td><strong>Net profit (operating result)</strong></td><td><strong>{fmt(dashboard.data.profitability.operatingResult)}</strong></td></tr>
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3>Current inventory value</h3>
            <p style={{ fontSize: 18 }}>{fmt(dashboard.data.currentInventoryValue)} PKR</p>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Point-in-time value of unsold stock, as of now — not limited to the selected period.</p>
          </div>

          <div className="panel">
            <h3>Expenses by category</h3>
            {dashboard.data.expensesByCategory.length === 0 && <p style={{ color: "var(--text-muted)" }}>No posted expenses in this period.</p>}
            {dashboard.data.expensesByCategory.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.data.expensesByCategory.map((line) => (
                    <tr key={line.categoryId}>
                      <td>{line.label}</td>
                      <td>{fmt(line.total)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td><strong>Total</strong></td>
                    <td><strong>{fmt(dashboard.data.totalExpenses)}</strong></td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
