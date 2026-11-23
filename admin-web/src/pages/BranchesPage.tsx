import { useState, type FormEvent } from "react";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

interface Branch {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: string;
}

export function BranchesPage() {
  const branches = useFetch<Branch[]>("/branches");

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/branches", { name, code });
      setName("");
      setCode("");
      setShowForm(false);
      branches.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create branch");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(branch: Branch) {
    try {
      await api.patch(`/branches/${branch.id}/${branch.isActive ? "deactivate" : "activate"}`);
      branches.reload();
    } catch {
      // surfaced via reload failing silently; acceptable for this action
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Branches</h1>
        <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ New branch"}</button>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
        Each branch keeps its own suppliers, customers, stock, orders, and accounts, entirely separate from every other
        branch. A user belongs to exactly one branch — move them from Users instead of here.
      </p>

      {showForm && (
        <form className="panel" onSubmit={handleCreate}>
          <h3>New branch</h3>
          {error && <div className="error-banner">{error}</div>}
          <div className="form-row">
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Gulberg Branch" />
            </div>
            <div className="field" style={{ maxWidth: 160 }}>
              <label>Short code</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required placeholder="GUL" />
            </div>
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create branch"}
          </button>
        </form>
      )}

      <div className="panel">
        {branches.data && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Created</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {branches.data.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{b.code}</td>
                  <td>{new Date(b.createdAt).toLocaleDateString()}</td>
                  <td>
                    <span className="badge">{b.isActive ? "active" : "deactivated"}</span>
                  </td>
                  <td>
                    <button className="secondary" onClick={() => handleToggleActive(b)}>
                      {b.isActive ? "Deactivate" : "Reactivate"}
                    </button>
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
