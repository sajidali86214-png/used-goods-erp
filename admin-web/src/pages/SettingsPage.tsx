import { useState, type FormEvent } from "react";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

type Tab = "categories" | "grades" | "bins" | "channels" | "accounts" | "periods";

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("categories");

  return (
    <div>
      <h1>Settings</h1>
      <div className="tabs">
        {(["categories", "grades", "bins", "channels", "accounts", "periods"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === "categories" && <SimpleList path="/settings/categories" fields={[{ key: "name", label: "Name" }]} />}
      {tab === "grades" && <SimpleList path="/settings/grades" fields={[{ key: "code", label: "Code" }, { key: "label", label: "Label" }]} />}
      {tab === "bins" && <SimpleList path="/settings/bins" fields={[{ key: "code", label: "Code" }, { key: "label", label: "Label" }]} />}
      {tab === "channels" && <SimpleList path="/settings/channels" fields={[{ key: "code", label: "Code" }, { key: "label", label: "Label" }]} />}
      {tab === "accounts" && <AccountsTab />}
      {tab === "periods" && <PeriodsTab />}
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
            </tr>
          </thead>
          <tbody>
            {accounts.data.map((a) => (
              <tr key={a.id}>
                <td>{a.label}</td>
                <td>{a.kind}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
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
      await api.post("/finance/periods/lock", { periodStart, periodEnd });
      setSuccess("Period locked.");
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
    </div>
  );
}
