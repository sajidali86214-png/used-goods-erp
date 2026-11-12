import { useState, Fragment, type ChangeEvent, type FormEvent } from "react";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

type Tab = "categories" | "brands" | "grades" | "bins" | "channels" | "accounts" | "periods" | "documents" | "investors";

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("categories");

  return (
    <div>
      <h1>Settings</h1>
      <div className="tabs">
        {(["categories", "brands", "grades", "bins", "channels", "accounts", "periods", "documents", "investors"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === "categories" && <SimpleList path="/settings/categories" fields={[{ key: "name", label: "Name" }]} />}
      {tab === "brands" && <SimpleList path="/settings/brands" fields={[{ key: "name", label: "Name" }]} />}
      {tab === "grades" && <SimpleList path="/settings/grades" fields={[{ key: "code", label: "Code" }, { key: "label", label: "Label" }]} />}
      {tab === "bins" && <SimpleList path="/settings/bins" fields={[{ key: "code", label: "Code" }, { key: "label", label: "Label" }]} />}
      {tab === "channels" && <SimpleList path="/settings/channels" fields={[{ key: "code", label: "Code" }, { key: "label", label: "Label" }]} />}
      {tab === "accounts" && <AccountsTab />}
      {tab === "periods" && <PeriodsTab />}
      {tab === "documents" && <DocumentsTab />}
      {tab === "investors" && <InvestorsTab />}
    </div>
  );
}

function SimpleList({ path, fields }: { path: string; fields: { key: string; label: string }[] }) {
  const list = useFetch<Record<string, unknown>[]>(path);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(path, values);
      setValues({});
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create");
    }
  }

  return (
    <div className="panel">
      <form onSubmit={handleCreate} className="form-row" style={{ alignItems: "flex-end" }}>
        {fields.map((f) => (
          <div className="field" key={f.key}>
            <label>{f.label}</label>
            <input value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} required />
          </div>
        ))}
        <button type="submit" style={{ height: 36 }}>
          Add
        </button>
      </form>
      {error && <div className="error-banner">{error}</div>}
      {list.data && (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              {fields.map((f) => (
                <th key={f.key}>{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.data.map((row, i) => (
              <tr key={i}>
                {fields.map((f) => (
                  <td key={f.key}>{String(row[f.key] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface Currency {
  id: string;
  code: string;
}
interface Account {
  id: string;
  label: string;
  kind: string;
  currencyId: string;
}

function AccountsTab() {
  const accounts = useFetch<Account[]>("/settings/accounts");
  const currencies = useFetch<Currency[]>("/settings/currencies");
  const [label, setLabel] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [kind, setKind] = useState("bank");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/settings/accounts", { label, currencyId, kind });
      setLabel("");
      accounts.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create account");
    }
  }

  return (
    <div className="panel">
      <form onSubmit={handleCreate} className="form-row" style={{ alignItems: "flex-end" }}>
        <div className="field">
          <label>Label</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} required />
        </div>
        <div className="field">
          <label>Currency</label>
          <select value={currencyId} onChange={(e) => setCurrencyId(e.target.value)} required>
            <option value="">Select...</option>
            {currencies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="bank">bank</option>
            <option value="cash">cash</option>
            <option value="platform_escrow">platform_escrow</option>
          </select>
        </div>
        <button type="submit" style={{ height: 36 }}>
          Add account
        </button>
      </form>
      {error && <div className="error-banner">{error}</div>}
      {accounts.data && (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Label</th>
              <th>Kind</th>
              <th>Balance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.data.map((a) => (
              <AccountRow key={a.id} account={a} onChanged={() => accounts.reload()} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AccountRow({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const balance = useFetch<{ balance: string }>(`/finance/accounts/${account.id}/balance`);
  const [showOpeningBalance, setShowOpeningBalance] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const tx = await api.post<{ id: string }>("/finance/owner-transactions", {
        accountId: account.id,
        amount: Number(amount),
        type: "contribution",
      });
      await api.post(`/finance/post/owner-transactions/${tx.id}`);
      setShowOpeningBalance(false);
      setAmount("");
      balance.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not set opening balance");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr>
        <td>{account.label}</td>
        <td>{account.kind}</td>
        <td>{balance.data ? Number(balance.data.balance).toLocaleString() : "..."}</td>
        <td>
          <button className="secondary" onClick={() => setShowOpeningBalance((v) => !v)}>
            {showOpeningBalance ? "Cancel" : "Opening balance"}
          </button>
        </td>
      </tr>
      {showOpeningBalance && (
        <tr>
          <td colSpan={4}>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0" }}>
              Records the money already in this account before go-live, as an owner contribution (debits this account, credits Owner's Equity). Only
              available for PKR accounts.
            </p>
            {error && <div className="error-banner">{error}</div>}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div className="field" style={{ maxWidth: 200 }}>
                <label>Opening balance amount</label>
                <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <button disabled={saving || !amount} onClick={handleSave}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function PeriodsTab() {
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleLock(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const lock = await api.post<{ id: string }>("/finance/periods/lock", { periodStart, periodEnd });
      setSuccess(`Period locked. Lock ID (needed to reopen it later): ${lock.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not lock period");
    }
  }

  return (
    <div className="panel">
      <h3>Lock a financial period</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Owner-only. Once locked, no finance posting can be dated inside this range until it's reopened (reopening needs a reason and is fully audited).
      </p>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}
      <form onSubmit={handleLock} className="form-row" style={{ alignItems: "flex-end" }}>
        <div className="field">
          <label>Period start</label>
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />
        </div>
        <div className="field">
          <label>Period end</label>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
        </div>
        <button type="submit" style={{ height: 36 }}>
          Lock period
        </button>
      </form>

      <ReopenPeriodForm />
    </div>
  );
}

function ReopenPeriodForm() {
  const [periodLockId, setPeriodLockId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleReopen(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/finance/periods/${periodLockId}/reopen`, { reason });
      setSuccess("Period reopened.");
      setReason("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reopen period");
    }
  }

  return (
    <form onSubmit={handleReopen} className="form-row" style={{ alignItems: "flex-end", marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
      <div className="field">
        <label>Period lock ID to reopen</label>
        <input value={periodLockId} onChange={(e) => setPeriodLockId(e.target.value)} required placeholder="paste the lock's id" />
      </div>
      <div className="field">
        <label>Reason (required, audited)</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} required />
      </div>
      <button type="submit" className="secondary" style={{ height: 36 }}>
        Reopen period
      </button>
      {error && <div className="error-banner" style={{ width: "100%" }}>{error}</div>}
      {success && <div className="success-banner" style={{ width: "100%" }}>{success}</div>}
    </form>
  );
}

function DocumentsTab() {
  const letterhead = useFetch<{ key: string; value: string }>("/settings/app/letterhead_storage_key");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const uploaded = await api.uploadFile<{ id: string; url: string; storageKey: string }>("/media", file, { kind: "letterhead" });
      await api.put("/settings/app/letterhead_storage_key", { value: uploaded.storageKey });
      setSuccess("Letterhead uploaded — it'll now appear at the top of every PO PDF.");
      letterhead.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload letterhead");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="panel">
      <h3>Letterhead</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Upload your company letterhead image (logo/header) once — it's then embedded at the top of every downloaded purchase-order PDF.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}
      <p>
        Status: <span className="badge">{letterhead.data ? "uploaded" : "not set — PDFs use a placeholder header"}</span>
      </p>
      <div className="field" style={{ maxWidth: 320 }}>
        <label>{letterhead.data ? "Replace letterhead image" : "Upload letterhead image"}</label>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} disabled={uploading} />
      </div>
    </div>
  );
}

interface UserOption {
  id: string;
  name: string;
  email: string;
}
interface InvestorRow {
  id: string;
  name: string;
  profitSharePercent: string;
  profitShareBasis: string;
  isActive: boolean;
  user: UserOption | null;
}
interface InvestorTransactionRow {
  id: string;
  type: "contribution" | "withdrawal" | "distribution";
  amount: string;
  occurredAt: string;
  notes: string | null;
}

const BASIS_OPTIONS: { value: string; label: string }[] = [
  { value: "operating_result", label: "Operating result (gross profit − operating expenses)" },
  { value: "gross_profit", label: "Gross profit (net sales − COGS)" },
];

function InvestorsTab() {
  const investors = useFetch<InvestorRow[]>("/investors");
  const users = useFetch<UserOption[]>("/users");
  const [name, setName] = useState("");
  const [profitSharePercent, setProfitSharePercent] = useState("");
  const [profitShareBasis, setProfitShareBasis] = useState("operating_result");
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expandedInvestorId, setExpandedInvestorId] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/investors", {
        name,
        profitSharePercent: Number(profitSharePercent),
        profitShareBasis,
        userId: userId || undefined,
      });
      setName("");
      setProfitSharePercent("");
      setUserId("");
      investors.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create investor");
    }
  }

  return (
    <div className="panel">
      <h3>Investors</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Each investor here with a login attached sees only their own Investor Dashboard — nothing else in the app. Create their login first on the
        Users page with the "investor" role, then link it here.
      </p>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={handleCreate} className="form-row" style={{ alignItems: "flex-end" }}>
        <div className="field">
          <label>Investor name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label>Profit share %</label>
          <input type="number" min={0} max={100} step="0.01" value={profitSharePercent} onChange={(e) => setProfitSharePercent(e.target.value)} required />
        </div>
        <div className="field">
          <label>Share basis</label>
          <select value={profitShareBasis} onChange={(e) => setProfitShareBasis(e.target.value)}>
            {BASIS_OPTIONS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Linked login (optional)</label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">No login yet</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
        </div>
        <button type="submit" style={{ height: 36 }}>
          Add investor
        </button>
      </form>
      {investors.data && (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Share %</th>
              <th>Basis</th>
              <th>Login</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {investors.data.map((inv) => (
              <Fragment key={inv.id}>
                <tr>
                  <td>{inv.name}</td>
                  <td>{Number(inv.profitSharePercent)}%</td>
                  <td style={{ fontSize: 12 }}>{BASIS_OPTIONS.find((b) => b.value === inv.profitShareBasis)?.label ?? inv.profitShareBasis}</td>
                  <td>{inv.user ? `${inv.user.name} (${inv.user.email})` : "— not linked —"}</td>
                  <td>
                    <span className="badge">{inv.isActive ? "active" : "inactive"}</span>
                  </td>
                  <td>
                    <button className="secondary" onClick={() => setExpandedInvestorId((v) => (v === inv.id ? null : inv.id))}>
                      {expandedInvestorId === inv.id ? "Hide" : "Capital movements"}
                    </button>
                  </td>
                </tr>
                {expandedInvestorId === inv.id && (
                  <tr>
                    <td colSpan={6}>
                      <InvestorTransactionsPanel investorId={inv.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function InvestorTransactionsPanel({ investorId }: { investorId: string }) {
  const transactions = useFetch<InvestorTransactionRow[]>(`/investors/${investorId}/transactions`, [investorId]);
  const [type, setType] = useState<"contribution" | "withdrawal" | "distribution">("contribution");
  const [amount, setAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleRecord(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post(`/investors/${investorId}/transactions`, {
        type,
        amount: Number(amount),
        occurredAt: new Date(occurredAt).toISOString(),
        notes: notes || undefined,
      });
      setAmount("");
      setNotes("");
      transactions.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record transaction");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "8px 0" }}>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={handleRecord} className="form-row" style={{ alignItems: "flex-end" }}>
        <div className="field">
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="contribution">Contribution (capital in)</option>
            <option value="withdrawal">Withdrawal (capital out)</option>
            <option value="distribution">Distribution (profit share paid out)</option>
          </select>
        </div>
        <div className="field">
          <label>Amount (PKR)</label>
          <input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div className="field">
          <label>Date</label>
          <input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} required />
        </div>
        <div className="field">
          <label>Notes (optional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <button type="submit" disabled={saving} style={{ height: 36 }}>
          {saving ? "Saving..." : "Record"}
        </button>
      </form>
      {transactions.data && transactions.data.length > 0 && (
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {transactions.data.map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.occurredAt).toLocaleDateString()}</td>
                <td>{t.type}</td>
                <td>{Number(t.amount).toLocaleString()}</td>
                <td>{t.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {transactions.data && transactions.data.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 12 }}>No capital movements recorded yet.</p>}
    </div>
  );
}
