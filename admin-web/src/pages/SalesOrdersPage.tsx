import { useState, useEffect, Fragment, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";
import { useDraft } from "../lib/useDraft";

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
interface Account {
  id: string;
  label: string;
  kind: string;
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

interface NewOrderLine {
  productId: string;
  quantity: string;
  unitPrice: string;
  discountType: "none" | "percentage" | "fixed";
  discountValue: string;
  gradeRequirementType: "none" | "allowed_set" | "exact_composition";
  allowedGradeIds: string[];
  exactQtyByGrade: Record<string, string>;
}

function emptyOrderLine(): NewOrderLine {
  return {
    productId: "",
    quantity: "",
    unitPrice: "",
    discountType: "none",
    discountValue: "",
    gradeRequirementType: "none",
    allowedGradeIds: [],
    exactQtyByGrade: {},
  };
}

interface NewOrderDraft {
  showForm: boolean;
  externalOrderId: string;
  customerId: string;
  channelId: string;
  currencyId: string;
  shippingPerUnit: string;
  commissionType: "none" | "percentage" | "fixed";
  commissionValue: string;
  lines: NewOrderLine[];
}

function emptyNewOrderDraft(): NewOrderDraft {
  return {
    showForm: false,
    externalOrderId: "",
    customerId: "",
    channelId: "",
    currencyId: "",
    shippingPerUnit: "",
    commissionType: "none",
    commissionValue: "",
    lines: [emptyOrderLine()],
  };
}

function lineDiscountAmount(line: NewOrderLine): number {
  const gross = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
  const discountValueNum = Number(line.discountValue) || 0;
  if (line.discountType === "percentage") return (gross * discountValueNum) / 100;
  if (line.discountType === "fixed") return discountValueNum;
  return 0;
}

function lineTotal(line: NewOrderLine): number {
  const gross = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
  return gross - lineDiscountAmount(line);
}

export function SalesOrdersPage() {
  const { has } = useAuth();
  const orders = useFetch<SalesOrder[]>("/sales/orders");
  const customers = useFetch<Customer[]>("/customers");
  const channels = useFetch<Channel[]>("/settings/channels");
  const currencies = useFetch<Currency[]>("/settings/currencies");
  const products = useFetch<Product[]>("/products");
  const grades = useFetch<Grade[]>("/settings/grades");
  const accounts = useFetch<Account[]>("/settings/accounts");

  const [draft, setDraft, clearDraft] = useDraft<NewOrderDraft>("new-sales-order", emptyNewOrderDraft());
  const { showForm, externalOrderId, customerId, channelId, currencyId, shippingPerUnit, commissionType, commissionValue, lines } = draft;

  function patchDraft(patch: Partial<NewOrderDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
  }
  function setShowForm(update: boolean | ((prev: boolean) => boolean)) {
    setDraft((d) => ({ ...d, showForm: typeof update === "function" ? update(d.showForm) : update }));
  }
  const setExternalOrderId = (v: string) => patchDraft({ externalOrderId: v });
  const setCustomerId = (v: string) => patchDraft({ customerId: v });
  const setChannelId = (v: string) => patchDraft({ channelId: v });
  const setCurrencyId = (v: string) => patchDraft({ currencyId: v });
  const setShippingPerUnit = (v: string) => patchDraft({ shippingPerUnit: v });
  const setCommissionType = (v: NewOrderDraft["commissionType"]) => patchDraft({ commissionType: v });
  const setCommissionValue = (v: string) => patchDraft({ commissionValue: v });

  function updateLine(index: number, patch: Partial<NewOrderLine>) {
    setDraft((d) => ({ ...d, lines: d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  }
  function addLine() {
    setDraft((d) => ({ ...d, lines: [...d.lines, emptyOrderLine()] }));
  }
  function removeLine(index: number) {
    setDraft((d) => ({ ...d, lines: d.lines.length > 1 ? d.lines.filter((_, i) => i !== index) : d.lines }));
  }
  function toggleAllowedGrade(index: number, gradeId: string) {
    updateLine(index, {
      allowedGradeIds: lines[index]!.allowedGradeIds.includes(gradeId)
        ? lines[index]!.allowedGradeIds.filter((g) => g !== gradeId)
        : [...lines[index]!.allowedGradeIds, gradeId],
    });
  }
  function setExactQty(index: number, gradeId: string, value: string) {
    updateLine(index, { exactQtyByGrade: { ...lines[index]!.exactQtyByGrade, [gradeId]: value } });
  }

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
  const [fulfilmentNotice, setFulfilmentNotice] = useState<string | null>(null);

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
    setFulfilmentNotice(null);
    if (fulfilmentStatus === "returned") {
      setPendingAction({ orderId, kind: "return" });
      return;
    }
    if (fulfilmentStatus === "cancelled") {
      setPendingAction({ orderId, kind: "cancel" });
      return;
    }
    try {
      const result = await api.patch<{
        fulfilmentAutomation?: { fulfilled: { lineId: string; quantity: string }[]; skipped: { lineId: string; reason: string }[] };
      }>(`/sales/orders/${orderId}/status`, { fulfilmentStatus });
      const automation = result.fulfilmentAutomation;
      if (automation) {
        const fulfilledTotal = automation.fulfilled.reduce((sum, f) => sum + Number(f.quantity), 0);
        const parts = [
          fulfilledTotal > 0 && `${fulfilledTotal} piece(s) auto-reserved, picked, dispatched, and posted to the ledger`,
          automation.skipped.length > 0 && `${automation.skipped.length} line(s) need attention: ${automation.skipped.map((s) => s.reason).join("; ")}`,
        ].filter(Boolean);
        if (parts.length > 0) setFulfilmentNotice(parts.join(" — "));
      }
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

  const totalQuantityPreview = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  const grossPreview = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const discountAmountPreview = lines.reduce((sum, l) => sum + lineDiscountAmount(l), 0);
  const shippingPerUnitNum = Number(shippingPerUnit) || 0;
  const subtotalPreview = grossPreview - discountAmountPreview;
  const shippingTotalPreview = shippingPerUnitNum * totalQuantityPreview;
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
      const created = await api.post<SalesOrder>("/sales/orders", {
        customerId,
        channelId,
        externalOrderId: externalOrderId || undefined,
        currencyId,
        shippingPerUnit: shippingPerUnit ? Number(shippingPerUnit) : undefined,
        commissionType: commissionType === "none" ? undefined : commissionType,
        commissionValue: commissionType === "none" ? undefined : Number(commissionValue) || 0,
        lines: lines.map((line) => ({
          productId: line.productId,
          quantity: Number(line.quantity),
          unitPrice: line.unitPrice ? Number(line.unitPrice) : undefined,
          discountType: line.discountType === "none" ? undefined : line.discountType,
          discountValue: line.discountType === "none" ? undefined : Number(line.discountValue) || 0,
          gradeRequirementType: line.gradeRequirementType,
          allowedGradeIds: line.gradeRequirementType === "allowed_set" ? line.allowedGradeIds : undefined,
          exactGradeQuantities:
            line.gradeRequirementType === "exact_composition"
              ? Object.fromEntries(Object.entries(line.exactQtyByGrade).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]))
              : undefined,
        })),
      });
      clearDraft();
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
      {fulfilmentNotice && <div className="panel success-banner">{fulfilmentNotice}</div>}
      {statusError && !pendingAction && <div className="panel error-banner">{statusError}</div>}

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
          <p style={{ color: "var(--text-muted)", fontSize: 12 }}>Line items (mixed-grade, no ratio promised, unless a grade requirement is set per line):</p>
          {lines.map((line, index) => (
            <div key={index} className="panel" style={{ marginBottom: 12 }}>
              <div className="form-row">
                <div className="field">
                  <label>Product</label>
                  <select value={line.productId} onChange={(e) => updateLine(index, { productId: e.target.value })} required>
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
                  <input type="number" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} required min={1} />
                </div>
                <div className="field">
                  <label>Unit price (optional)</label>
                  <input type="number" value={line.unitPrice} onChange={(e) => updateLine(index, { unitPrice: e.target.value })} min={0} step="0.01" />
                </div>
                <div className="field" style={{ maxWidth: 140 }}>
                  <label>Line total</label>
                  <p style={{ margin: "6px 0", fontWeight: 600 }}>{lineTotal(line).toLocaleString()}</p>
                </div>
                {lines.length > 1 && (
                  <div className="field" style={{ justifyContent: "flex-end" }}>
                    <label>&nbsp;</label>
                    <button type="button" className="secondary" onClick={() => removeLine(index)}>
                      Remove
                    </button>
                  </div>
                )}
              </div>

              <div className="form-row">
                <div className="field">
                  <label>Discount</label>
                  <select value={line.discountType} onChange={(e) => updateLine(index, { discountType: e.target.value as NewOrderLine["discountType"] })}>
                    <option value="none">No discount</option>
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed amount</option>
                  </select>
                </div>
                {line.discountType !== "none" && (
                  <div className="field">
                    <label>{line.discountType === "percentage" ? "Discount %" : "Discount amount"}</label>
                    <input
                      type="number"
                      value={line.discountValue}
                      onChange={(e) => updateLine(index, { discountValue: e.target.value })}
                      min={0}
                      step="0.01"
                    />
                  </div>
                )}
                <div className="field">
                  <label>Grade requirement</label>
                  <select
                    value={line.gradeRequirementType}
                    onChange={(e) => updateLine(index, { gradeRequirementType: e.target.value as NewOrderLine["gradeRequirementType"] })}
                  >
                    <option value="none">None — mixed grade, no ratio promised</option>
                    <option value="allowed_set">Allowed grades only</option>
                    <option value="exact_composition">Exact composition</option>
                  </select>
                </div>
              </div>

              {line.gradeRequirementType === "allowed_set" && (
                <div className="field">
                  <label>Which grades are allowed?</label>
                  <div style={{ display: "flex", gap: 10 }}>
                    {grades.data?.map((g) => (
                      <label key={g.id} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 13 }}>
                        <input
                          type="checkbox"
                          style={{ width: "auto" }}
                          checked={line.allowedGradeIds.includes(g.id)}
                          onChange={() => toggleAllowedGrade(index, g.id)}
                        />
                        {g.code}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {line.gradeRequirementType === "exact_composition" && (
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
                          value={line.exactQtyByGrade[g.id] ?? ""}
                          onChange={(e) => setExactQty(index, g.id, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          <div style={{ marginBottom: 12 }}>
            <button type="button" className="secondary" onClick={addLine}>
              + Add line
            </button>
          </div>

          <div className="form-row">
            <div className="field">
              <label>Shipping per piece (optional)</label>
              <input type="number" value={shippingPerUnit} onChange={(e) => setShippingPerUnit(e.target.value)} min={0} step="0.01" />
              {shippingPerUnitNum > 0 && (
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {shippingPerUnitNum} × {totalQuantityPreview} pcs = {shippingTotalPreview.toLocaleString()} total shipping
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

          {totalQuantityPreview > 0 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Gross {grossPreview.toLocaleString()}
              {discountAmountPreview > 0 && ` − discount ${discountAmountPreview.toLocaleString()}`} = subtotal {subtotalPreview.toLocaleString()} −
              shipping {shippingTotalPreview.toLocaleString()}
              {commissionType !== "none" && ` − commission ${commissionAmountPreview.toLocaleString()} (on ${commissionBasePreview.toLocaleString()})`}{" "}
              = <strong>net {netTotalPreview.toLocaleString()}</strong> ({totalQuantityPreview} pcs across {lines.length} line
              {lines.length === 1 ? "" : "s"})
            </p>
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
                <th>Pieces</th>
                <th>Amount</th>
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
                    <td>{o.lines.reduce((sum, l) => sum + Number(l.quantity), 0).toLocaleString()}</td>
                    <td>{Number(o.costSummary?.netTotal ?? 0).toLocaleString()}</td>
                  </tr>
                  {pendingAction?.orderId === o.id && pendingAction.kind === "payment" && (
                    <tr>
                      <td colSpan={10} style={{ background: "var(--panel-alt, #f6f7f9)" }}>
                        <PaymentActionPopup
                          orderId={o.id}
                          accounts={accounts.data ?? []}
                          onCancel={() => setPendingAction(null)}
                          onRecorded={() => {
                            setPendingAction(null);
                            orders.reload();
                          }}
                        />
                      </td>
                    </tr>
                  )}
                  {pendingAction?.orderId === o.id && pendingAction.kind !== "payment" && (
                    <tr>
                      <td colSpan={10} style={{ background: "var(--panel-alt, #f6f7f9)" }}>
                        <StatusActionPopup
                          order={o}
                          action={pendingAction}
                          accounts={accounts.data ?? []}
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
                              const result = await api.patch<{ refundError?: string }>(`/sales/orders/${o.id}/status`, payload);
                              if (result.refundError) {
                                setStatusError(`Status saved, but the refund could not be posted: ${result.refundError}`);
                              } else {
                                setPendingAction(null);
                              }
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
  accounts,
  error,
  saving,
  onCancel,
  onSave,
}: {
  order: SalesOrder;
  action: PendingAction;
  accounts: Account[];
  error: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [returnedQuantity, setReturnedQuantity] = useState(order.returnedQuantity ?? "");
  const [refundAmount, setRefundAmount] = useState(order.refundAmount ?? "");
  const [cancellationAmount, setCancellationAmount] = useState(order.cancellationAmount ?? "");
  const [refundAccountId, setRefundAccountId] = useState("");

  if (action.kind === "return") {
    const refundAmountNum = Number(refundAmount) || 0;
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
          {refundAmountNum > 0 && (
            <div className="field" style={{ maxWidth: 220 }}>
              <label>Refund from account</label>
              <select value={refundAccountId} onChange={(e) => setRefundAccountId(e.target.value)} required>
                <option value="">Select...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} ({a.kind})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            disabled={saving || (refundAmountNum > 0 && !refundAccountId)}
            onClick={() =>
              onSave({
                fulfilmentStatus: "returned",
                returnedQuantity: Number(returnedQuantity) || 0,
                refundAmount: refundAmountNum,
                refundAccountId: refundAmountNum > 0 ? refundAccountId : undefined,
              })
            }
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
          A refund amount posts a real, linked refund from the chosen account. The pieces returned label does not move stock automatically — use
          the detailed Returns workflow to put inventory back into a specific grade.
        </p>
      </div>
    );
  }

  const cancellationAmountNum = Number(cancellationAmount) || 0;
  return (
    <div style={{ padding: 12 }}>
      <strong>Cancel order — {order.orderNumber}</strong>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-row" style={{ marginTop: 6 }}>
        <div className="field" style={{ maxWidth: 200 }}>
          <label>Cancellation amount (refunded, if any)</label>
          <input type="number" min={0} step="0.01" value={cancellationAmount} onChange={(e) => setCancellationAmount(e.target.value)} />
        </div>
        {cancellationAmountNum > 0 && (
          <div className="field" style={{ maxWidth: 220 }}>
            <label>Refund from account</label>
            <select value={refundAccountId} onChange={(e) => setRefundAccountId(e.target.value)} required>
              <option value="">Select...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.kind})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          disabled={saving || (cancellationAmountNum > 0 && !refundAccountId)}
          onClick={() =>
            onSave({
              fulfilmentStatus: "cancelled",
              cancellationAmount: cancellationAmountNum,
              refundAccountId: cancellationAmountNum > 0 ? refundAccountId : undefined,
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

interface PaymentSummary {
  amountDue: string;
  amountReceived: string;
  outstanding: string;
}

/**
 * Replaces the old "just set a label" payment popup: this is the real
 * finance flow — creates + posts the customer receipt and syncs the
 * order's paymentStatus label in one call (see
 * POST /sales/orders/:id/record-payment), so there's nothing left to also
 * enter in Customer Receipts.
 */
function PaymentActionPopup({
  orderId,
  accounts,
  onCancel,
  onRecorded,
}: {
  orderId: string;
  accounts: Account[];
  onCancel: () => void;
  onRecorded: () => void;
}) {
  const summary = useFetch<PaymentSummary>(`/sales/orders/${orderId}/payment-summary`, [orderId]);
  const outstanding = Number(summary.data?.outstanding ?? 0);

  const [amount, setAmount] = useState("");
  const [destinationAccountId, setDestinationAccountId] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [bankReference, setBankReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Prefill the amount to the full outstanding balance once it's known —
  // editable, so a partial payment is just as easy to enter.
  useEffect(() => {
    if (summary.data) setAmount((prev) => prev || String(outstanding));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.data]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/sales/orders/${orderId}/record-payment`, {
        amount: Number(amount),
        receivedAt: new Date(receivedAt).toISOString(),
        destinationAccountId,
        bankReference: bankReference || undefined,
      });
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record payment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ padding: 12 }}>
      <strong>Record a payment</strong>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0" }}>
        {summary.data
          ? `Received ${Number(summary.data.amountReceived).toLocaleString()} of ${Number(summary.data.amountDue).toLocaleString()} due — outstanding ${outstanding.toLocaleString()}.`
          : "Loading balance..."}
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-row">
        <div className="field" style={{ maxWidth: 160 }}>
          <label>Amount received</label>
          <input type="number" min={0.01} max={outstanding} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div className="field" style={{ maxWidth: 220 }}>
          <label>Receiving account</label>
          <select value={destinationAccountId} onChange={(e) => setDestinationAccountId(e.target.value)} required>
            <option value="">Select...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.kind})
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ maxWidth: 160 }}>
          <label>Payment date</label>
          <input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} required />
        </div>
        <div className="field" style={{ maxWidth: 200 }}>
          <label>Reference (optional)</label>
          <input value={bankReference} onChange={(e) => setBankReference(e.target.value)} placeholder="Bank/transaction ref" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="submit" disabled={submitting || outstanding <= 0 || !destinationAccountId}>
          {submitting ? "Recording..." : "Record payment"}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
