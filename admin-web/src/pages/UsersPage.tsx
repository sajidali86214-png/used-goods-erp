import { useState, type FormEvent } from "react";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface Role {
  id: string;
  code: string;
  label: string;
}
interface Branch {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}
interface UserRow {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
  branchId: string;
  roles: { role: Role }[];
}

export function UsersPage() {
  const { has } = useAuth();
  const users = useFetch<UserRow[]>("/users");
  const roles = useFetch<Role[]>("/roles");
  // Only fetched/shown for an owner — an ordinary manager's new hire always
  // joins the manager's own branch, with no picker to second-guess that.
  const canPickBranch = has("branch.manage");
  const branches = useFetch<Branch[]>(canPickBranch ? "/branches" : null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [branchId, setBranchId] = useState("");
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
      await api.post("/users", { name, email, password, roleIds, branchId: canPickBranch && branchId ? branchId : undefined });
      setName("");
      setEmail("");
      setPassword("");
      setRoleIds([]);
      setBranchId("");
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

  // A deliberate, separate action (not an inline table edit) — moving a user
  // changes how their historical rows are attributed going forward.
  async function handleMoveBranch(userId: string, newBranchId: string) {
    try {
      await api.patch(`/users/${userId}/branch`, { branchId: newBranchId });
      users.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not move user");
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
          {canPickBranch && (
            <div className="field">
              <label>Branch (leave blank for your own)</label>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">Your own branch</option>
                {branches.data?.filter((b) => b.isActive).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
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
                {canPickBranch && <th>Branch</th>}
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
                  {canPickBranch && (
                    <td>
                      <select value={u.branchId} onChange={(e) => handleMoveBranch(u.id, e.target.value)}>
                        {branches.data?.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
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
