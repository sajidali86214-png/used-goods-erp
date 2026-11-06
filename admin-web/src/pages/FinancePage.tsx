import { useState, type FormEvent } from "react";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

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
  const [tab, setTab] = useState<"expenses" | "receipts" | "balances">("expenses");
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
      </div>

      {tab === "expenses" && <ExpenseForm accounts={accounts.data ?? []} currencies={currencies.data ?? []} />}
      {tab === "receipts" && <ReceiptForm accounts={accounts.data ?? []} currencies={currencies.data ?? []} />}
      {tab === "balances" && <AccountBalances accounts={accounts.data ?? []} />}
    </div>
  );
}

function ExpenseForm({ accounts, currencies }: { accounts: Account[]; currencies: Currency[] }) {
  const categories = useFetch<ExpenseCategory[]>("/settings/expense-categories");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [amount, setAmount] = useState("");
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
      setAmount("");
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
