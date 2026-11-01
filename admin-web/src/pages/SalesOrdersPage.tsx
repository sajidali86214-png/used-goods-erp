import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

interface Customer {
  id: string;
  name: string;
}
interface Channel {
  id: string;
  code: string;
  label: string;
}
interface Currency {
  id: string;
  code: string;
}
interface Product {
  id: string;
  skuCode: string;
  name: string;
}
interface SalesOrder {
  id: string;
  orderNumber: string;
  status: string;
  fulfilmentStatus: string;
  customer: Customer;
  lines: { quantity: string }[];
}

export function SalesOrdersPage() {
  const { has } = useAuth();
  const orders = useFetch<SalesOrder[]>("/sales/orders");
  const customers = useFetch<Customer[]>("/customers");
  const channels = useFetch<Channel[]>("/settings/channels");
  const currencies = useFetch<Currency[]>("/settings/currencies");
  const products = useFetch<Product[]>("/products");

  const [showForm, setShowForm] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/sales/orders", {
        orderNumber,
        customerId,
        channelId,
        currencyId,
        lines: [{ productId, quantity: Number(quantity), unitPrice: unitPrice ? Number(unitPrice) : undefined, gradeRequirementType: "none" }],
      });
      setShowForm(false);
      setOrderNumber("");
      setQuantity("");
      setUnitPrice("");
      orders.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Sales Orders</h1>
        {has("order.create") && <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ New order"}</button>}
      </div>

      {showForm && (
        <form className="panel" onSubmit={handleCreate}>
          <h3>New sales order</h3>
          {error && <div className="error-banner">{error}</div>}
          <div className="form-row">
            <div className="field">
              <label>Order number</label>
              <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} required />
            </div>
            <div className="field">
              <label>Customer</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
                <option value="">Select...</option>
                {customers.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>Channel</label>
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)} required>
                <option value="">Select...</option>
                {channels.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
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
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: 12 }}>First line item (mixed-grade, no ratio promised):</p>
          <div className="form-row">
            <div className="field">
              <label>Product</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
                <option value="">Select...</option>
                {products.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.skuCode} — {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Quantity</label>
              <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} required min={1} />
            </div>
            <div className="field">
              <label>Unit price (optional)</label>
              <input type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} min={0} />
            </div>
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create order"}
          </button>
        </form>
      )}

      <div className="panel">
        {orders.loading && <p>Loading...</p>}
        {orders.error && <div className="error-banner">{orders.error}</div>}
        {orders.data && (
          <table>
            <thead>
              <tr>
                <th>Order #</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Fulfilment</th>
                <th>Lines</th>
              </tr>
            </thead>
            <tbody>
              {orders.data.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={`/sales/${o.id}`}>{o.orderNumber}</Link>
                  </td>
                  <td>{o.customer.name}</td>
                  <td>
                    <span className="badge">{o.status}</span>
                  </td>
                  <td>
                    <span className="badge">{o.fulfilmentStatus}</span>
                  </td>
                  <td>{o.lines.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
