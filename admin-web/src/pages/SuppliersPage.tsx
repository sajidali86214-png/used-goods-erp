import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { useDebouncedValue } from "../api/useDebouncedValue";
import { api, ApiError } from "../api/client";
import { useDraft } from "../lib/useDraft";
import { DraftStatus } from "../components/DraftStatus";
import { downloadCsv, toCsv } from "../lib/csv";

interface SupplierStatementLine {
  date: string;
  type: string;
  description: string;
  amount: string;
  runningBalance: string;
}

interface NewSupplierDraft {
  name: string;
  defaultCurrencyId: string;
  contactPerson: string;
  phone: string;
}
function emptySupplierDraft(): NewSupplierDraft {
  return { name: "", defaultCurrencyId: "", contactPerson: "", phone: "" };
}

interface Supplier {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  isActive: boolean;
}

interface Currency {
  id: string;
  code: string;
}

export function SuppliersPage() {
  const { has } = useAuth();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const suppliers = useFetch<Supplier[]>(`/suppliers${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ""}`, [debouncedSearch]);
  const currencies = useFetch<Currency[]>("/settings/currencies");

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft, clearDraft, draftSavedAt] = useDraft<NewSupplierDraft>("new-supplier", emptySupplierDraft());
  const { name, defaultCurrencyId, contactPerson, phone } = draft;
  const setName = (v: string) => setDraft((d) => ({ ...d, name: v }));
  const setDefaultCurrencyId = (v: string) => setDraft((d) => ({ ...d, defaultCurrencyId: v }));
  const setContactPerson = (v: string) => setDraft((d) => ({ ...d, contactPerson: v }));
  const setPhone = (v: string) => setDraft((d) => ({ ...d, phone: v }));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleDownloadStatement(supplierId: string, supplierName: string) {
    try {
      const statement = await api.get<{ lines: SupplierStatementLine[] }>(`/reports/suppliers/${supplierId}/statement`);
      const columns: { header: string; value: (l: SupplierStatementLine) => string | number }[] = [
        { header: "Date", value: (l) => new Date(l.date).toLocaleDateString() },
        { header: "Type", value: (l) => l.type },
        { header: "Description", value: (l) => l.description },
        { header: "Amount", value: (l) => l.amount },
        { header: "Running balance", value: (l) => l.runningBalance },
      ];
      downloadCsv(
        `${supplierName.replace(/\s+/g, "-")}-statement-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(statement.lines, columns),
      );
    } catch {
      // Download is a convenience action off a list row; a failed fetch here isn't worth a dedicated error banner.
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/suppliers", { name, defaultCurrencyId, contactPerson: contactPerson || undefined, phone: phone || undefined });
      clearDraft();
      setShowForm(false);
      suppliers.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create supplier");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Suppliers</h1>
        {has("settings.manage") && (
          <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ Add supplier"}</button>
        )}
      </div>

      {showForm && (
        <form className="panel" onSubmit={handleCreate}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>New supplier</h3>
            <DraftStatus lastSavedAt={draftSavedAt} />
          </div>
          {error && <div className="error-banner">{error}</div>}
          <div className="form-row">
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Default currency</label>
              <select value={defaultCurrencyId} onChange={(e) => setDefaultCurrencyId(e.target.value)} required>
                <option value="">Select...</option>
                {currencies.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>Contact person</label>
              <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create supplier"}
          </button>
        </form>
      )}

      <div className="panel">
        <div className="field" style={{ maxWidth: 320 }}>
          <label>Search by name</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {suppliers.loading && <p>Loading...</p>}
        {suppliers.error && <div className="error-banner">{suppliers.error}</div>}
        {suppliers.data && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Phone</th>
                <th>Status</th>
                {has("supplier.payment_details.view") && <th></th>}
              </tr>
            </thead>
            <tbody>
              {suppliers.data.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.contactPerson ?? "—"}</td>
                  <td>{s.phone ?? "—"}</td>
                  <td>
                    <span className="badge">{s.isActive ? "active" : "inactive"}</span>
                  </td>
                  {has("supplier.payment_details.view") && (
                    <td>
                      <button className="secondary" onClick={() => handleDownloadStatement(s.id, s.name)}>
                        Statement
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
