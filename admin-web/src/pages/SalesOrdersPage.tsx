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
interface Grade {
  id: string;
  code: string;
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
  const grades = useFetch<Grade[]>("/settings/grades");

  const [showForm, setShowForm] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [gradeRequirementType, setGradeRequirementType] = useState<"none" | "allowed_set" | "exact_composition">("none");
  const [allowedGradeIds, setAllowedGradeIds] = useState<string[]>([]);
  const [exactQtyByGrade, setExactQtyByGrade] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleAllowedGrade(id: string) {
    setAllowedGradeIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const exactGradeQuantities =
        gradeRequirementType === "exact_composition"
          ? Object.fromEntries(Object.entries(exactQtyByGrade).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]))
          : undefined;

      await api.post("/sales/orders", {
        orderNumber,
        customerId,
        channelId,
        currencyId,
        lines: [
          {
            productId,
            quantity: Number(quantity),
            unitPrice: unitPrice ? Number(unitPrice) : undefined,
            gradeRequirementType,
            allowedGradeIds: gradeRequirementType === "allowed_set" ? allowedGradeIds : undefined,
            exactGradeQuantities,
          },
        ],
      });
      setShowForm(false);
      setOrderNumber("");
      setQuantity("");
      setUnitPrice("");
      setGradeRequirementType("none");
      setAllowedGradeIds([]);
      setExactQtyByGrade({});
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

          <div className="field">
            <label>Grade requirement</label>
            <select value={gradeRequirementType} onChange={(e) => setGradeRequirementType(e.target.value as typeof gradeRequirementType)}>
              <option value="none">None — mixed grade, no ratio promised</option>
              <option value="allowed_set">Allowed grades only</option>
              <option value="exact_composition">Exact composition</option>
            </select>
          </div>

          {gradeRequirementType === "allowed_set" && (
            <div className="field">
              <label>Which grades are allowed?</label>
              <div style={{ display: "flex", gap: 10 }}>
                {grades.data?.map((g) => (
                  <label key={g.id} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 13 }}>
                    <input type="checkbox" style={{ width: "auto" }} checked={allowedGradeIds.includes(g.id)} onChange={() => toggleAllowedGrade(g.id)} />
                    {g.code}
                  </label>
                ))}
              </div>
            </div>
          )}

          {gradeRequirementType === "exact_composition" && (
            <div className="field">
              <label>Required quantity per grade (must sum to the line quantity)</label>
              <div style={{ display: "flex", gap: 10 }}>
                {grades.data?.map((g) => (
                  <div key={g.id} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <span style={{ fontSize: 12 }}>{g.code}</span>
                    <input
                      type="number"
                      style={{ width: 60 }}
                      min={0}
                      value={exactQtyByGrade[g.id] ?? ""}
                      onChange={(e) => setExactQtyByGrade((v) => ({ ...v, [g.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

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
