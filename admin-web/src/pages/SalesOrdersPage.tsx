import { useState, Fragment, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

interface Customer {
  id: string;
  name: string;
  contact: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
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
  externalOrderId: string | null;
  status: string;
  fulfilmentStatus: string;
  paymentStatus: string;
  qcStatus: string;
  paymentReceivedAmount: string | null;
  returnedQuantity: string | null;
  refundAmount: string | null;
  cancellationAmount: string | null;
  customer: Customer;
  lines: { quantity: string }[];
  costSummary: { netTotal: string };
}

const QC_STATUS_OPTIONS = ["pending", "approved", "rejected"];
const FULFILMENT_STATUS_OPTIONS = [
  "unfulfilled",
  "picking",
  "packed",
  "partially_dispatched",
  "dispatched",
  "partially_delivered",
  "delivered",
  "returned",
  "cancelled",
];

type PendingAction =
  | { orderId: string; kind: "payment" }
  | { orderId: string; kind: "return" }
  | { orderId: string; kind: "cancel" };

export function SalesOrdersPage() {
  const { has } = useAuth();
  const orders = useFetch<SalesOrder[]>("/sales/orders");
  const customers = useFetch<Customer[]>("/customers");
  const channels = useFetch<Channel[]>("/settings/channels");
  const currencies = useFetch<Currency[]>("/settings/currencies");
  const products = useFetch<Product[]>("/products");
  const grades = useFetch<Grade[]>("/settings/grades");

  const [showForm, setShowForm] = useState(false);
  const [externalOrderId, setExternalOrderId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [shippingPerUnit, setShippingPerUnit] = useState("");
  const [discountType, setDiscountType] = useState<"none" | "percentage" | "fixed">("none");
  const [discountValue, setDiscountValue] = useState("");
  const [commissionType, setCommissionType] = useState<"none" | "percentage" | "fixed">("none");
  const [commissionValue, setCommissionValue] = useState("");
  const [gradeRequirementType, setGradeRequirementType] = useState<"none" | "allowed_set" | "exact_composition">("none");
  const [allowedGradeIds, setAllowedGradeIds] = useState<string[]>([]);
  const [exactQtyByGrade, setExactQtyByGrade] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");
  const [newCustomerCity, setNewCustomerCity] = useState("");
  const [newCustomerCountry, setNewCustomerCountry] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [savingCustomer, setSavingCustomer] = useState(false);

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);

  async function handleQcChange(orderId: string, qcStatus: string) {
    setStatusError(null);
    try {
      await api.patch(`/sales/orders/${orderId}/status`, { qcStatus });
      orders.reload();
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : "Could not update QC status");
    }
  }

  async function handleFulfilmentChange(orderId: string, fulfilmentStatus: string) {
    setStatusError(null);
    if (fulfilmentStatus === "returned") {
      setPendingAction({ orderId, kind: "return" });
      return;
    }
    if (fulfilmentStatus === "cancelled") {
      setPendingAction({ orderId, kind: "cancel" });
      return;
    }
    try {
      await api.patch(`/sales/orders/${orderId}/status`, { fulfilmentStatus });
      orders.reload();
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : "Could not update fulfilment status");
    }
  }

  async function handlePaymentChange(orderId: string, paymentStatus: string) {
    setStatusError(null);
    if (paymentStatus === "unpaid") {
      try {
        await api.patch(`/sales/orders/${orderId}/status`, { paymentStatus: "unpaid" });
        orders.reload();
      } catch (err) {
        setStatusError(err instanceof ApiError ? err.message : "Could not update payment status");
      }
      return;
    }
    setPendingAction({ orderId, kind: "payment" });
  }

  function toggleAllowedGrade(id: string) {
    setAllowedGradeIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  }

  function customerLabel(c: Customer) {
    const locality = [c.city, c.country].filter(Boolean).join(", ");
    const parts = [c.name, c.address, locality, c.contact].filter(Boolean);
    return parts.join(" — ");
  }

  async function handleCreateCustomer(e: FormEvent) {
    e.preventDefault();
    setCustomerError(null);
    setSavingCustomer(true);
    try {
      const created = await api.post<Customer>("/customers", {
        name: newCustomerName,
        address: newCustomerAddress || undefined,
        city: newCustomerCity || undefined,
        country: newCustomerCountry || undefined,
        contact: newCustomerPhone || undefined,
      });
      await customers.reload();
      setCustomerId(created.id);
      setShowNewCustomer(false);
      setNewCustomerName("");
      setNewCustomerAddress("");
      setNewCustomerCity("");
      setNewCustomerCountry("");
      setNewCustomerPhone("");
    } catch (err) {
      setCustomerError(err instanceof ApiError ? err.message : "Could not create customer");
    } finally {
      setSavingCustomer(false);
    }
  }

  const quantityNum = Number(quantity) || 0;
  const unitPriceNum = Number(unitPrice) || 0;
  const grossPreview = quantityNum * unitPriceNum;
  const discountValueNum = Number(discountValue) || 0;
  const discountAmountPreview =
    discountType === "percentage" ? (grossPreview * discountValueNum) / 100 : discountType === "fixed" ? discountValueNum : 0;
  const shippingPerUnitNum = Number(shippingPerUnit) || 0;
  const subtotalPreview = grossPreview - discountAmountPreview;
  const shippingTotalPreview = shippingPerUnitNum * quantityNum;
  const commissionBasePreview = subtotalPreview - shippingTotalPreview;
  const commissionValueNum = Number(commissionValue) || 0;
  const commissionAmountPreview =
    commissionType === "percentage" ? (commissionBasePreview * commissionValueNum) / 100 : commissionType === "fixed" ? commissionValueNum : 0;
  const netTotalPreview = subtotalPreview - shippingTotalPreview - commissionAmountPreview;

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const exactGradeQuantities =
        gradeRequirementType === "exact_composition"
          ? Object.fromEntries(Object.entries(exactQtyByGrade).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]))
          : undefined;

      const created = await api.post<SalesOrder>("/sales/orders", {
        customerId,
        channelId,
        externalOrderId: externalOrderId || undefined,
        currencyId,
        shippingPerUnit: shippingPerUnit ? Number(shippingPerUnit) : undefined,
        commissionType: commissionType === "none" ? undefined : commissionType,
        commissionValue: commissionType === "none" ? undefined : Number(commissionValue) || 0,
        lines: [
          {
            productId,
            quantity: Number(quantity),
            unitPrice: unitPrice ? Number(unitPrice) : undefined,
            discountType: discountType === "none" ? undefined : discountType,
            discountValue: discountType === "none" ? undefined : Number(discountValue) || 0,
            gradeRequirementType,
            allowedGradeIds: gradeRequirementType === "allowed_set" ? allowedGradeIds : undefined,
            exactGradeQuantities,
          },
        ],
      });
      setShowForm(false);
      setExternalOrderId("");
      setQuantity("");
      setUnitPrice("");
      setShippingPerUnit("");
      setDiscountType("none");
      setDiscountValue("");
      setCommissionType("none");
      setCommissionValue("");
      setGradeRequirementType("none");
      setAllowedGradeIds([]);
      setExactQtyByGrade({});
      setSuccessMessage(`Order ${created.orderNumber} created.`);
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
        {has("order.create") && (
          <button
            onClick={() => {
              setShowForm((v) => !v);
              setSuccessMessage(null);
            }}
          >
            {showForm ? "Cancel" : "+ New order"}
          </button>
        )}
      </div>

      {successMessage && !showForm && <div className="panel success-banner">{successMessage}</div>}

      {showForm && (
        <form className="panel" onSubmit={handleCreate}>
          <h3>New sales order</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 12 }}>The order number is assigned automatically once created.</p>
          {error && <div className="error-banner">{error}</div>}
          <div className="form-row">
            <div className="field">
              <label>Customer — name, address, city, country, phone</label>
              <div style={{ display: "flex", gap: 6 }}>
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required style={{ flex: 1 }}>
                  <option value="">Select...</option>
                  {customers.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {customerLabel(c)}
                    </option>
                  ))}
                </select>
                <button type="button" className="secondary" onClick={() => setShowNewCustomer((v) => !v)}>
                  {showNewCustomer ? "Cancel" : "+ New"}
                </button>
              </div>
            </div>
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
          </div>

          {showNewCustomer && (
            <div className="panel" style={{ marginBottom: 12 }}>
              <h4>New customer</h4>
              {customerError && <div className="error-banner">{customerError}</div>}
              <div className="form-row">
                <div className="field">
                  <label>Name</label>
                  <input value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Address</label>
                  <input value={newCustomerAddress} onChange={(e) => setNewCustomerAddress(e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="field">
                  <label>City</label>
                  <input value={newCustomerCity} onChange={(e) => setNewCustomerCity(e.target.value)} />
                </div>
                <div className="field">
                  <label>Country</label>
                  <input value={newCustomerCountry} onChange={(e) => setNewCustomerCountry(e.target.value)} />
                </div>
                <div className="field">
                  <label>Phone number</label>
                  <input value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} />
                </div>
              </div>
              <button type="button" disabled={savingCustomer || !newCustomerName} onClick={handleCreateCustomer}>
                {savingCustomer ? "Saving..." : "Save customer"}
              </button>
            </div>
          )}
          <div className="form-row">
            <div className="field">
              <label>Platform order # (Fleek, Poshmark, etc. — optional)</label>
              <input
                value={externalOrderId}
                onChange={(e) => setExternalOrderId(e.target.value)}
                placeholder="e.g. the order ID shown on the selling platform"
              />
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
              <input type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} min={0} step="0.01" />
            </div>
          </div>

          <div className="form-row">
            <div className="field">
              <label>Discount</label>
              <select value={discountType} onChange={(e) => setDiscountType(e.target.value as typeof discountType)}>
                <option value="none">No discount</option>
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </div>
            {discountType !== "none" && (
              <div className="field">
                <label>{discountType === "percentage" ? "Discount %" : "Discount amount"}</label>
                <input type="number" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} min={0} step="0.01" />
              </div>
            )}
          </div>

          <div className="form-row">
            <div className="field">
              <label>Shipping per piece (optional)</label>
              <input type="number" value={shippingPerUnit} onChange={(e) => setShippingPerUnit(e.target.value)} min={0} step="0.01" />
              {shippingPerUnitNum > 0 && (
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {shippingPerUnitNum} × {quantityNum} pcs = {shippingTotalPreview.toLocaleString()} total shipping
                </p>
              )}
            </div>
            <div className="field">
              <label>Commission</label>
              <select value={commissionType} onChange={(e) => setCommissionType(e.target.value as typeof commissionType)}>
                <option value="none">No commission</option>
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </div>
            {commissionType !== "none" && (
              <div className="field">
                <label>{commissionType === "percentage" ? "Commission %" : "Commission amount"}</label>
                <input type="number" value={commissionValue} onChange={(e) => setCommissionValue(e.target.value)} min={0} step="0.01" />
              </div>
            )}
          </div>

          {(discountType !== "none" || shippingPerUnitNum > 0 || commissionType !== "none") && quantityNum > 0 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Gross {grossPreview.toLocaleString()}
              {discountType !== "none" && ` − discount ${discountAmountPreview.toLocaleString()}`} = subtotal {subtotalPreview.toLocaleString()} − shipping{" "}
              {shippingTotalPreview.toLocaleString()}
              {commissionType !== "none" && ` − commission ${commissionAmountPreview.toLocaleString()} (on ${commissionBasePreview.toLocaleString()})`} ={" "}
              <strong>net {netTotalPreview.toLocaleString()}</strong>
            </p>
          )}

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
                <th>Platform order #</th>
                <th>Customer</th>
                <th>Status</th>
                <th>QC</th>
                <th>Fulfilment</th>
                <th>Payment</th>
                <th>Lines</th>
              </tr>
            </thead>
            <tbody>
              {orders.data.map((o) => (
                <Fragment key={o.id}>
                  <tr>
                    <td>
                      <Link to={`/sales/${o.id}`}>{o.orderNumber}</Link>
                    </td>
                    <td>{o.externalOrderId ?? "—"}</td>
                    <td>
                      <Link to={`/customers/${o.customer.id}`}>{o.customer.name}</Link>
                    </td>
                    <td>
                      <span className="badge">{o.status}</span>
                    </td>
                    <td>
                      {has("order.create") ? (
                        <select value={o.qcStatus} onChange={(e) => handleQcChange(o.id, e.target.value)} style={{ fontSize: 12, padding: "2px 4px" }}>
                          {QC_STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="badge">{o.qcStatus}</span>
                      )}
                    </td>
                    <td>
                      {has("order.create") ? (
                        <select
                          value={o.fulfilmentStatus}
                          onChange={(e) => handleFulfilmentChange(o.id, e.target.value)}
                          style={{ fontSize: 12, padding: "2px 4px" }}
                        >
                          {FULFILMENT_STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="badge">{o.fulfilmentStatus}</span>
                      )}
                    </td>
                    <td>
                      {has("order.create") ? (
                        <select
                          value={o.paymentStatus}
                          onChange={(e) => handlePaymentChange(o.id, e.target.value)}
                          style={{ fontSize: 12, padding: "2px 4px" }}
                        >
                          <option value="unpaid">unpaid</option>
                          <option value="partially_paid">partially paid</option>
                          <option value="paid">paid</option>
                        </select>
                      ) : (
                        <span className="badge">{o.paymentStatus}</span>
                      )}
                    </td>
                    <td>{o.lines.length}</td>
                  </tr>
                  {pendingAction?.orderId === o.id && (
                    <tr>
                      <td colSpan={8} style={{ background: "var(--panel-alt, #f6f7f9)" }}>
                        <StatusActionPopup
                          order={o}
                          action={pendingAction}
                          error={statusError}
                          saving={statusSaving}
                          onCancel={() => {
                            setPendingAction(null);
                            setStatusError(null);
                          }}
                          onSave={async (payload) => {
                            setStatusSaving(true);
                            setStatusError(null);
                            try {
                              await api.patch(`/sales/orders/${o.id}/status`, payload);
                              setPendingAction(null);
                              orders.reload();
                            } catch (err) {
                              setStatusError(err instanceof ApiError ? err.message : "Could not save");
                            } finally {
                              setStatusSaving(false);
                            }
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatusActionPopup({
  order,
  action,
  error,
  saving,
  onCancel,
  onSave,
}: {
  order: SalesOrder;
  action: PendingAction;
  error: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const amountDue = Number(order.costSummary?.netTotal ?? 0);
  const [paymentAmount, setPaymentAmount] = useState(order.paymentReceivedAmount ?? String(amountDue));
  const [returnedQuantity, setReturnedQuantity] = useState(order.returnedQuantity ?? "");
  const [refundAmount, setRefundAmount] = useState(order.refundAmount ?? "");
  const [cancellationAmount, setCancellationAmount] = useState(order.cancellationAmount ?? "");

  if (action.kind === "payment") {
    const amountNum = Number(paymentAmount) || 0;
    const nextStatus = amountNum <= 0 ? "unpaid" : amountNum >= amountDue ? "paid" : "partially_paid";
    return (
      <div style={{ padding: 12 }}>
        <strong>Mark payment received — {order.orderNumber}</strong>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0" }}>Expected (net of discount/shipping/commission): {amountDue.toLocaleString()}</p>
        {error && <div className="error-banner">{error}</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div className="field" style={{ maxWidth: 200 }}>
            <label>Amount received</label>
            <input type="number" min={0} step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Will be marked as: {nextStatus.replace("_", " ")}</p>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            disabled={saving}
            onClick={() => onSave({ paymentStatus: nextStatus, paymentReceivedAmount: amountNum })}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (action.kind === "return") {
    return (
      <div style={{ padding: 12 }}>
        <strong>Mark returned — {order.orderNumber}</strong>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-row" style={{ marginTop: 6 }}>
          <div className="field" style={{ maxWidth: 160 }}>
            <label>Pieces returned</label>
            <input type="number" min={0} value={returnedQuantity} onChange={(e) => setReturnedQuantity(e.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 200 }}>
            <label>Refund amount</label>
            <input type="number" min={0} step="0.01" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            disabled={saving}
            onClick={() =>
              onSave({
                fulfilmentStatus: "returned",
                returnedQuantity: Number(returnedQuantity) || 0,
                refundAmount: Number(refundAmount) || 0,
              })
            }
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <strong>Cancel order — {order.orderNumber}</strong>
      {error && <div className="error-banner">{error}</div>}
      <div className="field" style={{ maxWidth: 200, marginTop: 6 }}>
        <label>Cancellation amount (refunded, if any)</label>
        <input type="number" min={0} step="0.01" value={cancellationAmount} onChange={(e) => setCancellationAmount(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          disabled={saving}
          onClick={() => onSave({ fulfilmentStatus: "cancelled", cancellationAmount: Number(cancellationAmount) || 0 })}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
