import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { useDebouncedValue } from "../api/useDebouncedValue";
import { api, ApiError } from "../api/client";

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
  const [name, setName] = useState("");
  const [defaultCurrencyId, setDefaultCurrencyId] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/suppliers", { name, defaultCurrencyId, contactPerson: contactPerson || undefined, phone: phone || undefined });
      setName("");
      setContactPerson("");
      setPhone("");
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
          <h3>New supplier</h3>
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
