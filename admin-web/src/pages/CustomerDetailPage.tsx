import { useEffect, useState, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

interface CustomerOrder {
  id: string;
  orderNumber: string;
  externalOrderId: string | null;
  status: string;
  fulfilmentStatus: string;
  paymentStatus: string;
  createdAt: string;
  lineCount: number;
}

interface CustomerDetail {
  id: string;
  name: string;
  contact: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  notes: string | null;
  isActive: boolean;
  orders: CustomerOrder[];
  balance: { bookedValue: string; received: string; outstanding: string };
}

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const customer = useFetch<CustomerDetail>(`/customers/${id}`);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (customer.data) {
      setName(customer.data.name);
      setContact(customer.data.contact ?? "");
      setAddress(customer.data.address ?? "");
      setCity(customer.data.city ?? "");
      setCountry(customer.data.country ?? "");
      setNotes(customer.data.notes ?? "");
    }
  }, [customer.data]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.patch(`/customers/${id}`, {
        name,
        contact: contact || undefined,
        address: address || undefined,
        city: city || undefined,
        country: country || undefined,
        notes: notes || undefined,
      });
      setEditing(false);
      customer.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save customer");
    } finally {
      setSubmitting(false);
    }
  }

  if (customer.loading) return <p>Loading...</p>;
  if (customer.error) return <div className="error-banner">{customer.error}</div>;
  const c = customer.data;
  if (!c) return null;

  return (
    <div>
      <p>
        <Link to="/sales">← Back to orders</Link>
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>{c.name}</h1>
        {has("order.create") && !editing && <button onClick={() => setEditing(true)}>Edit</button>}
      </div>

      {editing ? (
        <form className="panel" onSubmit={handleSave}>
          <h3>Edit customer</h3>
          {error && <div className="error-banner">{error}</div>}
          <div className="form-row">
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Contact (phone/email)</label>
              <input value={contact} onChange={(e) => setContact(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>Address</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="field">
              <label>City</label>
              <input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="field">
              <label>Country</label>
              <input value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="panel">
          <div className="form-row">
            <div>
              <strong>Contact</strong>
              <p>{c.contact ?? "—"}</p>
            </div>
            <div>
              <strong>Address</strong>
              <p>{c.address ?? "—"}</p>
            </div>
            <div>
              <strong>City, Country</strong>
              <p>{[c.city, c.country].filter(Boolean).join(", ") || "—"}</p>
            </div>
          </div>
          {c.notes && (
            <div>
              <strong>Notes</strong>
              <p>{c.notes}</p>
            </div>
          )}
          <span className="badge">{c.isActive ? "active" : "inactive"}</span>
        </div>
      )}

      <div className="panel">
        <h3>Balance</h3>
        <div className="form-row">
          <div>
            <strong>Booked value</strong>
            <p>{Number(c.balance.bookedValue).toLocaleString()}</p>
          </div>
          <div>
            <strong>Received</strong>
            <p>{Number(c.balance.received).toLocaleString()}</p>
          </div>
          <div>
            <strong>Outstanding</strong>
            <p>{Number(c.balance.outstanding).toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Order history</h3>
        {c.orders.length === 0 ? (
          <p>No orders yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Order #</th>
                <th>Platform order #</th>
                <th>Status</th>
                <th>Fulfilment</th>
                <th>Payment</th>
                <th>Lines</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {c.orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={`/sales/${o.id}`}>{o.orderNumber}</Link>
                  </td>
                  <td>{o.externalOrderId ?? "—"}</td>
                  <td>
                    <span className="badge">{o.status}</span>
                  </td>
                  <td>
                    <span className="badge">{o.fulfilmentStatus}</span>
                  </td>
                  <td>
                    <span className="badge">{o.paymentStatus}</span>
                  </td>
                  <td>{o.lineCount}</td>
                  <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
