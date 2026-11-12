import { useState } from "react";
import { useFetch } from "../api/useFetch";
import { downloadCsv, toCsv } from "../lib/csv";

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
  receivables: string;
  supplierAdvancesOutstanding: string;
}
interface Capital {
  totalContributed: string;
  totalWithdrawn: string;
  totalDistributed: string;
  remainingPayable: string;
}
interface InvestorDashboard {
  investor: { id: string; name: string; profitSharePercent: string; profitShareBasis: string };
  periodFrom: string | null;
  periodTo: string | null;
  profitability: Profitability;
  profitShareAmount: string;
  capital: Capital;
  currentInventoryValue: string;
  expensesByCategory: ExpenseCategoryLine[];
  totalExpenses: string;
  cashAndBankBalance: string;
}

function fmt(n: string | number) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const BASIS_LABEL: Record<string, string> = {
  gross_profit: "Gross profit (net sales − COGS)",
  operating_result: "Operating result (gross profit − operating expenses)",
};

export function InvestorDashboardPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const query = [from && `from=${from}`, to && `to=${to}`].filter(Boolean).join("&");
  const dashboard = useFetch<InvestorDashboard>(`/investor/dashboard${query ? `?${query}` : ""}`, [from, to]);

  function handleDownload() {
    if (!dashboard.data) return;
    const d = dashboard.data;
    const rows = [
      { label: "Investor", value: d.investor.name },
      { label: "Agreed profit share %", value: `${Number(d.investor.profitSharePercent)}%` },
      { label: "Profit share basis", value: BASIS_LABEL[d.investor.profitShareBasis] ?? d.investor.profitShareBasis },
      { label: "Period from", value: d.periodFrom ?? "all-time" },
      { label: "Period to", value: d.periodTo ?? "all-time" },
      { label: "Gross sales", value: d.profitability.grossSales },
      { label: "Net sales", value: d.profitability.netSales },
      { label: "COGS", value: d.profitability.cogs },
      { label: "Gross profit", value: d.profitability.grossProfit },
      { label: "Operating expenses", value: d.profitability.operatingExpenses },
      { label: "Operating result", value: d.profitability.operatingResult },
      { label: "Calculated profit share", value: d.profitShareAmount },
      { label: "Contributed", value: d.capital.totalContributed },
      { label: "Withdrawn", value: d.capital.totalWithdrawn },
      { label: "Distributed", value: d.capital.totalDistributed },
      { label: "Remaining payable", value: d.capital.remainingPayable },
      { label: "Current inventory value", value: d.currentInventoryValue },
      { label: "Receivables", value: d.profitability.receivables },
      { label: "Supplier advances outstanding", value: d.profitability.supplierAdvancesOutstanding },
      { label: "Cash & bank balance", value: d.cashAndBankBalance },
      { label: "Total expenses", value: d.totalExpenses },
      ...d.expensesByCategory.map((l) => ({ label: `Expense — ${l.label}`, value: l.total })),
    ];
    downloadCsv(
      `investor-summary-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows, [
        { header: "Line", value: (r) => r.label },
        { header: "Value", value: (r) => r.value },
      ]),
    );
  }

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
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button className="secondary" onClick={handleDownload}>
              Download summary CSV
            </button>
          </div>

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
                  <td>Calculation basis</td>
                  <td>{BASIS_LABEL[dashboard.data.investor.profitShareBasis] ?? dashboard.data.investor.profitShareBasis}</td>
                </tr>
                <tr>
                  <td>
                    <strong>Your calculated share for this period</strong>
                  </td>
                  <td>
                    <strong>{fmt(dashboard.data.profitShareAmount)} PKR</strong>
                  </td>
                </tr>
                <tr>
                  <td>Already distributed (all-time)</td>
                  <td>{fmt(dashboard.data.capital.totalDistributed)} PKR</td>
                </tr>
                <tr>
                  <td>
                    <strong>Remaining payable</strong>
                  </td>
                  <td>
                    <strong>{fmt(dashboard.data.capital.remainingPayable)} PKR</strong>
                  </td>
                </tr>
              </tbody>
            </table>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
              This is a calculated share of trading results, not cash confirmed available to pay out — check "Cash & bank balance" below before
              any distribution.
            </p>
          </div>

          <div className="panel">
            <h3>Your capital account</h3>
            <table>
              <tbody>
                <tr>
                  <td>Total contributed</td>
                  <td>{fmt(dashboard.data.capital.totalContributed)} PKR</td>
                </tr>
                <tr>
                  <td>Total withdrawn</td>
                  <td>{fmt(dashboard.data.capital.totalWithdrawn)} PKR</td>
                </tr>
                <tr>
                  <td>Total distributed</td>
                  <td>{fmt(dashboard.data.capital.totalDistributed)} PKR</td>
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
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
              Note: posted sales revenue is currently gross of shipping/commission (those are shown net on each sales order's own total, but not
              yet split into a separate "direct selling costs" ledger line) — a known limitation, not an error in this dashboard.
            </p>
          </div>

          <div className="panel">
            <h3>Inventory, receivables, and liabilities</h3>
            <table>
              <tbody>
                <tr>
                  <td>Current inventory value</td>
                  <td>{fmt(dashboard.data.currentInventoryValue)} PKR</td>
                </tr>
                <tr>
                  <td>Receivables outstanding</td>
                  <td>{fmt(dashboard.data.profitability.receivables)} PKR</td>
                </tr>
                <tr>
                  <td>Supplier advances outstanding</td>
                  <td>{fmt(dashboard.data.profitability.supplierAdvancesOutstanding)} PKR</td>
                </tr>
                <tr>
                  <td>
                    <strong>Cash &amp; bank balance (actual, right now)</strong>
                  </td>
                  <td>
                    <strong>{fmt(dashboard.data.cashAndBankBalance)} PKR</strong>
                  </td>
                </tr>
              </tbody>
            </table>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Inventory value is a point-in-time snapshot, as of now — not limited to the selected period.</p>
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
