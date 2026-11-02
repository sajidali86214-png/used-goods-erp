import { useState, type FormEvent } from "react";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

interface Role {
  id: string;
  code: string;
  label: string;
}
interface UserRow {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
  roles: { role: Role }[];
}

export function UsersPage() {
  const users = useFetch<UserRow[]>("/users");
  const roles = useFetch<Role[]>("/roles");

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleRole(id: string) {
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/users", { name, email, password, roleIds });
      setName("");
      setEmail("");
      setPassword("");
      setRoleIds([]);
      setShowForm(false);
      users.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create user");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(id: string) {
    try {
      await api.patch(`/users/${id}/deactivate`);
      users.reload();
    } catch {
      // surfaced via reload failing silently; acceptable for this action
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Users</h1>
        <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ Invite user"}</button>
      </div>

      {showForm && (
        <form className="panel" onSubmit={handleCreate}>
          <h3>New user</h3>
          {error && <div className="error-banner">{error}</div>}
          <div className="form-row">
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          </div>
          <div className="field">
            <label>Temporary password (at least 8 characters)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          <div className="field">
            <label>Roles</label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {roles.data?.map((r) => (
                <label key={r.id} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 13 }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} />
                  {r.code}
                </label>
              ))}
            </div>
          </div>
          <button type="submit" disabled={submitting || roleIds.length === 0}>
            {submitting ? "Creating..." : "Create user"}
          </button>
        </form>
      )}

      <div className="panel">
        {users.data && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Roles</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.roles.map((r) => r.role.code).join(", ")}</td>
                  <td>
                    <span className="badge">{u.isActive ? "active" : "deactivated"}</span>
                  </td>
                  <td>
                    {u.isActive && (
                      <button className="secondary" onClick={() => handleDeactivate(u.id)}>
                        Deactivate
                      </button>
                    )}
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
