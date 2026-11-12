import { useState, type FormEvent } from "react";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";
import { downloadCsv, toCsv } from "../lib/csv";
import { useDraft } from "../lib/useDraft";

interface Account {
  id: string;
  label: string;
  currencyId: string;
  kind: string;
}
interface Currency {
  id: string;
  code: string;
}
interface ExpenseCategory {
  id: string;
  label: string;
}
interface Order {
  id: string;
  orderNumber: string;
  currencyId: string;
}

export function FinancePage() {
  const [tab, setTab] = useState<"expenses" | "receipts" | "balances" | "ledger">("expenses");
  const accounts = useFetch<Account[]>("/settings/accounts");
  const currencies = useFetch<Currency[]>("/settings/currencies");

  return (
    <div>
      <h1>Finance</h1>
      <div className="tabs">
        <button className={tab === "expenses" ? "active" : ""} onClick={() => setTab("expenses")}>
          Expenses
        </button>
        <button className={tab === "receipts" ? "active" : ""} onClick={() => setTab("receipts")}>
          Customer Receipts
        </button>
        <button className={tab === "balances" ? "active" : ""} onClick={() => setTab("balances")}>
          Account Balances
        </button>
        <button className={tab === "ledger" ? "active" : ""} onClick={() => setTab("ledger")}>
          Ledger
        </button>
      </div>

      {tab === "expenses" && <ExpenseForm accounts={accounts.data ?? []} currencies={currencies.data ?? []} />}
      {tab === "receipts" && <ReceiptForm accounts={accounts.data ?? []} currencies={currencies.data ?? []} />}
      {tab === "balances" && <AccountBalances accounts={accounts.data ?? []} />}
      {tab === "ledger" && <LedgerTab accounts={accounts.data ?? []} />}
    </div>
  );
}

interface StatementLine {
  id: string;
  postedAt: string;
  party: string | null;
  description: string;
  category: string | null;
  currencyId: string;
  amount: string;
  sourceDocumentType: string | null;
  sourceDocumentId: string | null;
  runningBalance: string;
}
interface Statement {
  account: { id: string; label: string; kind: string; currencyId: string };
  periodFrom: string | null;
  periodTo: string | null;
  openingBalance: string;
  closingBalance: string;
  moneyIn: string;
  moneyOut: string;
  lines: StatementLine[];
}

function LedgerTab({ accounts }: { accounts: Account[] }) {
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [partyFilter, setPartyFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const query = new URLSearchParams();
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  const statement = useFetch<Statement>(
    accountId ? `/finance/accounts/${accountId}/statement${query.toString() ? `?${query.toString()}` : ""}` : null,
    [accountId, from, to],
  );

  const types = [...new Set((statement.data?.lines ?? []).map((l) => l.sourceDocumentType).filter(Boolean))] as string[];
  const filteredLines = (statement.data?.lines ?? []).filter((l) => {
    if (partyFilter && !(l.party ?? "").toLowerCase().includes(partyFilter.toLowerCase())) return false;
    if (typeFilter && l.sourceDocumentType !== typeFilter) return false;
    return true;
  });

  function handleDownload() {
    if (!statement.data) return;
    const csv = toCsv(filteredLines, [
      { header: "Date", value: (l) => new Date(l.postedAt).toISOString().slice(0, 10) },
      { header: "Party", value: (l) => l.party ?? "" },
      { header: "Description", value: (l) => l.description },
      { header: "Category", value: (l) => l.category ?? "" },
      { header: "Amount", value: (l) => l.amount },
      { header: "Running balance", value: (l) => l.runningBalance },
      { header: "Source", value: (l) => `${l.sourceDocumentType ?? ""} ${l.sourceDocumentId ?? ""}` },
    ]);
    downloadCsv(`${statement.data.account.label}-statement-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div className="panel">
      <h3>Account statement</h3>
      <div className="form-row">
        <div className="field">
          <label>Account</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
            <option value="">Select...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.kind})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field">
          <label>Party contains</label>
          <input value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)} placeholder="e.g. a customer or supplier name" />
        </div>
        <div className="field">
          <label>Type</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!accountId && <p style={{ color: "var(--text-muted)" }}>Select an account to see its statement.</p>}
      {statement.loading && <p>Loading...</p>}
      {statement.data && (
        <>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <div className="stat-tile">
              <div className="value">{Number(statement.data.openingBalance).toLocaleString()}</div>
              <div className="label">Opening balance</div>
            </div>
            <div className="stat-tile">
              <div className="value">{Number(statement.data.moneyIn).toLocaleString()}</div>
              <div className="label">Money in</div>
            </div>
            <div className="stat-tile">
              <div className="value">{Number(statement.data.moneyOut).toLocaleString()}</div>
              <div className="label">Money out</div>
            </div>
            <div className="stat-tile">
              <div className="value">{Number(statement.data.closingBalance).toLocaleString()}</div>
              <div className="label">Closing balance</div>
            </div>
          </div>
          <button className="secondary" onClick={handleDownload} disabled={filteredLines.length === 0} style={{ marginBottom: 8 }}>
            Download statement CSV
          </button>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Party</th>
                <th>Description</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Running balance</th>
              </tr>
            </thead>
            <tbody>
              {filteredLines.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.postedAt).toLocaleDateString()}</td>
                  <td>{l.party ?? "—"}</td>
                  <td>{l.description}</td>
                  <td>{l.category ?? "—"}</td>
                  <td style={{ color: Number(l.amount) < 0 ? "var(--danger, #b91c1c)" : undefined }}>{Number(l.amount).toLocaleString()}</td>
                  <td>{Number(l.runningBalance).toLocaleString()}</td>
                </tr>
              ))}
              {filteredLines.length === 0 && (
                <tr>
                  <td colSpan={6}>No transactions match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

interface ExpenseDraft {
  categoryId: string;
  accountId: string;
  currencyId: string;
  amount: string;
}
function emptyExpenseDraft(): ExpenseDraft {
  return { categoryId: "", accountId: "", currencyId: "", amount: "" };
}

function ExpenseForm({ accounts, currencies }: { accounts: Account[]; currencies: Currency[] }) {
  const categories = useFetch<ExpenseCategory[]>("/settings/expense-categories");
  const [draft, setDraft, clearDraft] = useDraft<ExpenseDraft>("new-expense", emptyExpenseDraft());
  const { categoryId, accountId, currencyId, amount } = draft;
  const setCategoryId = (v: string) => setDraft((d) => ({ ...d, categoryId: v }));
  const setAccountId = (v: string) => setDraft((d) => ({ ...d, accountId: v }));
  const setCurrencyId = (v: string) => setDraft((d) => ({ ...d, currencyId: v }));
  const setAmount = (v: string) => setDraft((d) => ({ ...d, amount: v }));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const expense = await api.post<{ id: string }>("/finance/expenses", {
        date: new Date().toISOString(),
        payeeType: "other",
        categoryId,
        currencyId,
        amount: Number(amount),
        paymentStatus: "paid",
        accountId,
      });
      await api.post(`/finance/post/expenses/${expense.id}`);
      setSuccess("Expense recorded and posted to the ledger.");
      clearDraft();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record expense");
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h3>Record an expense</h3>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}
      <div className="form-row">
        <div className="field">
          <label>Category</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="">Select...</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Paid from account</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
            <option value="">Select...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label>Currency</label>
          <select value={currencyId} onChange={(e) => setCurrencyId(e.target.value)} required>
            <option value="">Select...</option>
            {currencies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Amount</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required min={0} step="0.01" />
        </div>
      </div>
      <button type="submit">Record expense</button>
    </form>
  );
}

function ReceiptForm({ accounts, currencies }: { accounts: Account[]; currencies: Currency[] }) {
  const orders = useFetch<Order[]>("/sales/orders");
  const [orderId, setOrderId] = useState("");
  const [destinationAccountId, setDestinationAccountId] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const rate = await api.post<{ id: string }>("/finance/exchange-rates", {
        fromCurrencyId: currencyId,
        toCurrencyId: currencyId,
        rate: 1,
        source: "admin-web manual entry",
      });
      await api.post("/finance/receipts", {
        currencyId,
        amount: Number(amount),
        receivedAt: new Date().toISOString(),
        destinationAccountId,
        exchangeRateSnapshotId: rate.id,
        allocations: [{ orderId, amount: Number(amount) }],
      });
      setSuccess("Receipt recorded.");
      setAmount("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record receipt");
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h3>Record a customer receipt</h3>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}
      <div className="form-row">
        <div className="field">
          <label>Order</label>
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)} required>
            <option value="">Select...</option>
            {orders.data?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNumber}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Destination account</label>
          <select value={destinationAccountId} onChange={(e) => setDestinationAccountId(e.target.value)} required>
            <option value="">Select...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label>Currency</label>
          <select value={currencyId} onChange={(e) => setCurrencyId(e.target.value)} required>
            <option value="">Select...</option>
            {currencies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Amount received</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required min={0} step="0.01" />
        </div>
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
        A 1:1 indicative rate is locked automatically for same-currency receipts. For foreign-currency receipts, lock the actual rate via Settings first.
      </p>
      <button type="submit">Record receipt</button>
    </form>
  );
}

function AccountBalances({ accounts }: { accounts: Account[] }) {
  return (
    <div className="panel">
      <table>
        <thead>
          <tr>
            <th>Account</th>
            <th>Kind</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <BalanceRow key={a.id} account={a} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BalanceRow({ account }: { account: Account }) {
  const balance = useFetch<{ balance: string }>(`/finance/accounts/${account.id}/balance`);
  return (
    <tr>
      <td>{account.label}</td>
      <td>{account.kind}</td>
      <td>{balance.data ? Number(balance.data.balance).toLocaleString() : "..."}</td>
    </tr>
  );
}
