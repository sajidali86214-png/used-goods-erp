import { useState, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

interface Grade {
  id: string;
  code: string;
  label: string;
}

interface Reservation {
  id: string;
  costLayerId: string;
  gradeId: string;
  binId: string;
  quantity: string;
  status: string;
}
interface PickAllocation {
  id: string;
  costLayerId: string;
  gradeId: string;
  binId: string;
  pickedQty: string;
}
interface OrderLine {
  id: string;
  productId: string;
  product: { skuCode: string; name: string };
  quantity: string;
  unitPrice: string | null;
  discount: string | null;
  discountType: "percentage" | "fixed" | null;
  discountValue: string | null;
  gradeRequirementType: string;
  allowedGradeIds: string[];
  exactGradeQuantities: Record<string, number> | null;
  reservations: Reservation[];
  pickAllocations: PickAllocation[];
}
interface ShipmentLine {
  id: string;
  pickAllocationId: string | null;
  quantity: string;
}
interface Shipment {
  id: string;
  courier: string | null;
  status: string;
  lines: ShipmentLine[];
}
interface CostSummary {
  totalQuantity: string;
  discountTotal: string;
  subtotal: string;
  shippingTotal: string;
  commissionBase: string;
  commissionAmount: string;
  netTotal: string;
}
interface OrderDetail {
  id: string;
  orderNumber: string;
  externalOrderId: string | null;
  status: string;
  fulfilmentStatus: string;
  paymentStatus: string;
  qcStatus: string;
  channelId: string;
  shippingPerUnit: string | null;
  commissionType: "percentage" | "fixed" | null;
  commissionValue: string | null;
  notes: string | null;
  customer: { id: string; name: string };
  lines: OrderLine[];
  shipments: Shipment[];
  costSummary: CostSummary;
}
interface PaymentSummary {
  amountDue: string;
  amountReceived: string;
  outstanding: string;
}
interface Channel {
  id: string;
  code: string;
  label: string;
}
interface Account {
  id: string;
  label: string;
  currencyId: string;
  kind: string;
}
interface Currency {
  id: string;
  code: string;
}

interface AllocationCandidate {
  costLayerId: string;
  gradeId: string;
  binId: string;
  quantity: string;
}

export function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const order = useFetch<OrderDetail>(`/sales/orders/${id}`);
  const grades = useFetch<Grade[]>("/settings/grades");
  const paymentSummary = useFetch<PaymentSummary>(`/sales/orders/${id}/payment-summary`, [id]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  if (order.loading) return <p>Loading...</p>;
  if (!order.data) return <p>Order not found.</p>;
  const o = order.data;

  function alreadyPicked(line: OrderLine): number {
    return line.pickAllocations.reduce((sum, p) => sum + Number(p.pickedQty), 0);
  }

  function pickedForGrade(line: OrderLine, gradeId: string): number {
    return line.pickAllocations.filter((p) => p.gradeId === gradeId).reduce((sum, p) => sum + Number(p.pickedQty), 0);
  }

  async function handlePickGrade(line: OrderLine, gradeId: string, qty: number) {
    setError(null);
    setBusy(`${line.id}-${gradeId}`);
    try {
      const { candidates } = await api.post<{ candidates: AllocationCandidate[] }>("/sales/allocations/suggest", {
        productId: line.productId,
        quantity: qty,
        allowedGradeIds: [gradeId],
      });
      if (candidates.length === 0) {
        throw new ApiError(409, { error: `No saleable stock available in that grade` });
      }
      for (const c of candidates) {
        await api.post("/sales/reservations", {
          orderLineId: line.id,
          costLayerId: c.costLayerId,
          gradeId: c.gradeId,
          binId: c.binId,
          quantity: Number(c.quantity),
        });
        await api.post("/sales/picks", {
          orderLineId: line.id,
          costLayerId: c.costLayerId,
          gradeId: c.gradeId,
          binId: c.binId,
          quantity: Number(c.quantity),
        });
      }
      order.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not pick that grade");
    } finally {
      setBusy(null);
    }
  }

  async function handleAmend(line: OrderLine, addAllowedGradeId: string, reason: string) {
    setError(null);
    try {
      await api.post(`/sales/order-lines/${line.id}/amend-grade`, { addAllowedGradeId, reason });
      order.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not amend grade requirement");
    }
  }

  async function handleFulfillLine(line: OrderLine) {
    setError(null);
    setBusy(line.id);
    try {
      const remaining = Number(line.quantity) - alreadyPicked(line);
      if (remaining <= 0) return;

      // Only reachable for gradeRequirementType "none" — the Fulfil button below is gated to that case.
      const { candidates } = await api.post<{ candidates: AllocationCandidate[] }>("/sales/allocations/suggest", {
        productId: line.productId,
        quantity: remaining,
      });

      for (const c of candidates) {
        await api.post("/sales/reservations", {
          orderLineId: line.id,
          costLayerId: c.costLayerId,
          gradeId: c.gradeId,
          binId: c.binId,
          quantity: Number(c.quantity),
        });
        await api.post("/sales/picks", {
          orderLineId: line.id,
          costLayerId: c.costLayerId,
          gradeId: c.gradeId,
          binId: c.binId,
          quantity: Number(c.quantity),
        });
      }
      order.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not fulfil line");
    } finally {
      setBusy(null);
    }
  }

  async function handleDispatchPick(pick: PickAllocation) {
    setError(null);
    setBusy(pick.id);
    try {
      await api.post("/sales/dispatches", { pickAllocationId: pick.id, quantity: Number(pick.pickedQty) });
      order.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not dispatch");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p>
        <Link to="/sales">← Back to orders</Link>
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>{o.orderNumber}</h1>
        {o.paymentStatus === "unpaid" && has("order.create") && !editing && (
          <button onClick={() => setEditing(true)}>Edit order</button>
        )}
      </div>
      {o.externalOrderId && (
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Platform order #: {o.externalOrderId}</p>
      )}
      <p>
        <Link to={`/customers/${o.customer.id}`}>{o.customer.name}</Link> · <span className="badge">{o.status}</span> ·{" "}
        <span className="badge">qc: {o.qcStatus}</span> · <span className="badge">{o.fulfilmentStatus}</span> ·{" "}
        <span className="badge">payment: {o.paymentStatus}</span>
      </p>
      {o.paymentStatus !== "unpaid" && (
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          This order's financial terms (price, discount, shipping, commission) can no longer be edited — payment has already been received against it.
          Status below can still be updated any time.
        </p>
      )}
      {error && <div className="error-banner">{error}</div>}

      {has("order.create") && (
        <OrderStatusPanel
          order={o}
          onChanged={() => {
            order.reload();
            paymentSummary.reload();
          }}
        />
      )}

      <div className="panel">
        <h3>Payment</h3>
        {paymentSummary.data && (
          <p>
            Received <strong>{Number(paymentSummary.data.amountReceived).toLocaleString()}</strong> of{" "}
            <strong>{Number(paymentSummary.data.amountDue).toLocaleString()}</strong> due
            {Number(paymentSummary.data.outstanding) > 0 && ` — outstanding ${Number(paymentSummary.data.outstanding).toLocaleString()}`}
          </p>
        )}
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {Number(o.costSummary.discountTotal) > 0 && `Discount ${Number(o.costSummary.discountTotal).toLocaleString()} → `}
          Subtotal {Number(o.costSummary.subtotal).toLocaleString()} − shipping {Number(o.costSummary.shippingTotal).toLocaleString()}
          {o.commissionType && ` − commission ${Number(o.costSummary.commissionAmount).toLocaleString()}`} = net{" "}
          {Number(o.costSummary.netTotal).toLocaleString()}
        </p>
        {has("finance.payment") && paymentSummary.data && Number(paymentSummary.data.outstanding) > 0 && (
          <RecordPaymentForm
            orderId={o.id}
            customerId={o.customer.id}
            outstanding={Number(paymentSummary.data.outstanding)}
            currentPaymentStatus={o.paymentStatus}
            onRecorded={() => {
              order.reload();
              paymentSummary.reload();
            }}
          />
        )}
      </div>

      {editing && (
        <OrderEditPanel
          order={o}
          onDone={() => {
            setEditing(false);
            order.reload();
            paymentSummary.reload();
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {o.lines.map((line) => {
        const picked = alreadyPicked(line);
        const remaining = Number(line.quantity) - picked;
        return (
          <div key={line.id} className="panel">
            <h3>
              {line.product.skuCode} — {line.product.name}
            </h3>
            <p>
              Ordered {line.quantity} · Picked {picked} · Remaining {remaining}
              {line.gradeRequirementType !== "none" && <span className="badge" style={{ marginLeft: 8 }}>{line.gradeRequirementType}</span>}
            </p>

            {remaining > 0 && has("order.create") && line.gradeRequirementType === "none" && (
              <button onClick={() => handleFulfillLine(line)} disabled={busy === line.id}>
                {busy === line.id ? "Working..." : `Fulfil ${remaining} (FIFO reserve + pick)`}
              </button>
            )}

            {line.gradeRequirementType === "allowed_set" && (
              <RestrictedGradePicker
                allowedGradeIds={line.allowedGradeIds}
                grades={grades.data ?? []}
                pickedForGrade={(gradeId) => pickedForGrade(line, gradeId)}
                lineRemaining={remaining}
                busyKey={busy}
                lineId={line.id}
                canPick={has("order.pick")}
                canAmend={has("order.grade_amend")}
                onPick={(gradeId, qty) => handlePickGrade(line, gradeId, qty)}
                onAmend={(gradeId, reason) => handleAmend(line, gradeId, reason)}
              />
            )}

            {line.gradeRequirementType === "exact_composition" && line.exactGradeQuantities && (
              <ExactCompositionPicker
                required={line.exactGradeQuantities}
                grades={grades.data ?? []}
                pickedForGrade={(gradeId) => pickedForGrade(line, gradeId)}
                busyKey={busy}
                lineId={line.id}
                canPick={has("order.pick")}
                onPick={(gradeId, qty) => handlePickGrade(line, gradeId, qty)}
              />
            )}

            {line.pickAllocations.length > 0 && (
              <table style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Pick</th>
                    <th>Qty</th>
                    <th>Dispatched</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {line.pickAllocations.map((p) => {
                    const dispatchedQty = o.shipments
                      .flatMap((s) => s.lines)
                      .filter((sl) => sl.pickAllocationId === p.id)
                      .reduce((sum, sl) => sum + Number(sl.quantity), 0);
                    const fullyDispatched = dispatchedQty >= Number(p.pickedQty);
                    return (
                      <tr key={p.id}>
                        <td>{p.id.slice(0, 8)}</td>
                        <td>{p.pickedQty}</td>
                        <td>{dispatchedQty}</td>
                        <td>
                          {!fullyDispatched && has("order.dispatch") && (
                            <button className="secondary" onClick={() => handleDispatchPick(p)} disabled={busy === p.id}>
                              {busy === p.id ? "..." : "Dispatch"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RestrictedGradePicker({
  allowedGradeIds,
  grades,
  pickedForGrade,
  lineRemaining,
  busyKey,
  lineId,
  canPick,
  canAmend,
  onPick,
  onAmend,
}: {
  allowedGradeIds: string[];
  grades: Grade[];
  pickedForGrade: (gradeId: string) => number;
  lineRemaining: number;
  busyKey: string | null;
  lineId: string;
  canPick: boolean;
  canAmend: boolean;
  onPick: (gradeId: string, qty: number) => void;
  onAmend: (gradeId: string, reason: string) => void;
}) {
  const [qtyByGrade, setQtyByGrade] = useState<Record<string, string>>({});
  const [showAmend, setShowAmend] = useState(false);
  const [amendGradeId, setAmendGradeId] = useState("");
  const [amendReason, setAmendReason] = useState("");

  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Allowed grades only — pick each grade separately:</p>
      {allowedGradeIds.map((gradeId) => {
        const grade = grades.find((g) => g.id === gradeId);
        const picked = pickedForGrade(gradeId);
        const key = `${lineId}-${gradeId}`;
        return (
          <div key={gradeId} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span className="badge">{grade?.code ?? gradeId.slice(0, 8)}</span>
            <span style={{ fontSize: 12 }}>picked {picked}</span>
            {canPick && lineRemaining > 0 && (
              <>
                <input
                  type="number"
                  style={{ width: 70 }}
                  min={1}
                  max={lineRemaining}
                  value={qtyByGrade[gradeId] ?? ""}
                  onChange={(e) => setQtyByGrade((v) => ({ ...v, [gradeId]: e.target.value }))}
                  placeholder="qty"
                />
                <button
                  className="secondary"
                  disabled={busyKey === key || !qtyByGrade[gradeId]}
                  onClick={() => onPick(gradeId, Number(qtyByGrade[gradeId]))}
                >
                  {busyKey === key ? "..." : "Pick"}
                </button>
              </>
            )}
          </div>
        );
      })}

      {canAmend && (
        <div style={{ marginTop: 6 }}>
          <button className="secondary" onClick={() => setShowAmend((v) => !v)}>
            {showAmend ? "Cancel" : "+ Allow another grade (amend)"}
          </button>
          {showAmend && (
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <select value={amendGradeId} onChange={(e) => setAmendGradeId(e.target.value)} style={{ width: 100 }}>
                <option value="">Grade...</option>
                {grades.filter((g) => !allowedGradeIds.includes(g.id)).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code}
                  </option>
                ))}
              </select>
              <input
                value={amendReason}
                onChange={(e) => setAmendReason(e.target.value)}
                placeholder="Reason (audited)"
                style={{ width: 220 }}
              />
              <button
                disabled={!amendGradeId || !amendReason}
                onClick={() => {
                  onAmend(amendGradeId, amendReason);
                  setShowAmend(false);
                  setAmendGradeId("");
                  setAmendReason("");
                }}
              >
                Confirm amendment
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExactCompositionPicker({
  required,
  grades,
  pickedForGrade,
  busyKey,
  lineId,
  canPick,
  onPick,
}: {
  required: Record<string, number>;
  grades: Grade[];
  pickedForGrade: (gradeId: string) => number;
  busyKey: string | null;
  lineId: string;
  canPick: boolean;
  onPick: (gradeId: string, qty: number) => void;
}) {
  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Exact composition required:</p>
      {Object.entries(required).map(([gradeId, requiredQty]) => {
        const grade = grades.find((g) => g.id === gradeId);
        const picked = pickedForGrade(gradeId);
        const remaining = requiredQty - picked;
        const key = `${lineId}-${gradeId}`;
        return (
          <div key={gradeId} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span className="badge">{grade?.code ?? gradeId.slice(0, 8)}</span>
            <span style={{ fontSize: 12 }}>
              required {requiredQty} · picked {picked} · remaining {remaining}
            </span>
            {canPick && remaining > 0 && (
              <button className="secondary" disabled={busyKey === key} onClick={() => onPick(gradeId, remaining)}>
                {busyKey === key ? "..." : `Pick ${remaining}`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const QC_STATUS_OPTIONS = ["pending", "approved", "rejected"];
const PAYMENT_STATUS_OPTIONS = ["unpaid", "partially_paid", "paid"];
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

function OrderStatusPanel({ order, onChanged }: { order: OrderDetail; onChanged: () => void }) {
  const [qcStatus, setQcStatus] = useState(order.qcStatus);
  const [paymentStatus, setPaymentStatus] = useState(order.paymentStatus);
  const [fulfilmentStatus, setFulfilmentStatus] = useState(order.fulfilmentStatus);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = qcStatus !== order.qcStatus || paymentStatus !== order.paymentStatus || fulfilmentStatus !== order.fulfilmentStatus;

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await api.patch(`/sales/orders/${order.id}/status`, { qcStatus, paymentStatus, fulfilmentStatus });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update status");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel">
      <h3>Status</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        These are manual labels for tracking where the order stands — they don't move stock or post payments on their own.
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-row">
        <div className="field">
          <label>QC status</label>
          <select value={qcStatus} onChange={(e) => setQcStatus(e.target.value)}>
            {QC_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Payment status</label>
          <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
            {PAYMENT_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Fulfilment status</label>
          <select value={fulfilmentStatus} onChange={(e) => setFulfilmentStatus(e.target.value)}>
            {FULFILMENT_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button onClick={handleSave} disabled={!dirty || saving}>
        {saving ? "Saving..." : "Save status"}
      </button>
    </div>
  );
}

function RecordPaymentForm({
  orderId,
  outstanding,
  onRecorded,
}: {
  orderId: string;
  customerId: string;
  outstanding: number;
  currentPaymentStatus: string;
  onRecorded: () => void;
}) {
  const accounts = useFetch<Account[]>("/settings/accounts");
  const [amount, setAmount] = useState(String(outstanding));
  const [destinationAccountId, setDestinationAccountId] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [bankReference, setBankReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await api.post(`/sales/orders/${orderId}/record-payment`, {
        amount: Number(amount),
        receivedAt: new Date(receivedAt).toISOString(),
        destinationAccountId,
        bankReference: bankReference || undefined,
      });
      setSuccess("Payment recorded and posted — no need to enter it again in Customer Receipts.");
      setBankReference("");
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record payment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit} style={{ marginTop: 12 }}>
      <h4 style={{ marginTop: 0 }}>Record a payment</h4>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}
      <div className="form-row">
        <div className="field">
          <label>Amount received</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            min={0.01}
            max={outstanding}
            step="0.01"
          />
        </div>
        <div className="field">
          <label>Receiving account</label>
          <select value={destinationAccountId} onChange={(e) => setDestinationAccountId(e.target.value)} required>
            <option value="">Select...</option>
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.kind})
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label>Payment date</label>
          <input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} required />
        </div>
        <div className="field">
          <label>Reference (optional)</label>
          <input value={bankReference} onChange={(e) => setBankReference(e.target.value)} placeholder="Bank/transaction ref" />
        </div>
      </div>
      <button type="submit" disabled={submitting || !destinationAccountId}>
        {submitting ? "Recording..." : "Record payment"}
      </button>
    </form>
  );
}

function OrderEditPanel({ order, onDone, onCancel }: { order: OrderDetail; onDone: () => void; onCancel: () => void }) {
  const channels = useFetch<Channel[]>("/settings/channels");
  const firstLine = order.lines[0];

  const [externalOrderId, setExternalOrderId] = useState(order.externalOrderId ?? "");
  const [channelId, setChannelId] = useState(order.channelId);
  const [notes, setNotes] = useState(order.notes ?? "");
  const [shippingPerUnit, setShippingPerUnit] = useState(order.shippingPerUnit ?? "");
  const [commissionType, setCommissionType] = useState<"none" | "percentage" | "fixed">(order.commissionType ?? "none");
  const [commissionValue, setCommissionValue] = useState(order.commissionValue ?? "");
  const [quantity, setQuantity] = useState(firstLine?.quantity ?? "");
  const [unitPrice, setUnitPrice] = useState(firstLine?.unitPrice ?? "");
  const [discountType, setDiscountType] = useState<"none" | "percentage" | "fixed">(firstLine?.discountType ?? "none");
  const [discountValue, setDiscountValue] = useState(firstLine?.discountValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    setError(null);
    setSubmitting(true);
    try {
      await api.patch(`/sales/orders/${order.id}`, {
        externalOrderId: externalOrderId || undefined,
        channelId,
        notes: notes || undefined,
        shippingPerUnit: shippingPerUnit ? Number(shippingPerUnit) : undefined,
        commissionType: commissionType === "none" ? null : commissionType,
        commissionValue: commissionType === "none" ? undefined : Number(commissionValue) || 0,
      });
      if (firstLine) {
        await api.patch(`/sales/order-lines/${firstLine.id}`, {
          quantity: quantity ? Number(quantity) : undefined,
          unitPrice: unitPrice ? Number(unitPrice) : undefined,
          discountType: discountType === "none" ? null : discountType,
          discountValue: discountType === "none" ? undefined : Number(discountValue) || 0,
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save changes");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel">
      <h3>Edit order</h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Editable until payment is received against this order.</p>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-row">
        <div className="field">
          <label>Channel</label>
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {channels.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Platform order #</label>
          <input value={externalOrderId} onChange={(e) => setExternalOrderId(e.target.value)} />
        </div>
      </div>
      {firstLine && (
        <div className="form-row">
          <div className="field">
            <label>Quantity ({firstLine.product.skuCode})</label>
            <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} min={1} />
          </div>
          <div className="field">
            <label>Unit price</label>
            <input type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} min={0} step="0.01" />
          </div>
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
      )}
      <div className="form-row">
        <div className="field">
          <label>Shipping per piece</label>
          <input type="number" value={shippingPerUnit} onChange={(e) => setShippingPerUnit(e.target.value)} min={0} step="0.01" />
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
      <div className="field">
        <label>Notes</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleSave} disabled={submitting}>
          {submitting ? "Saving..." : "Save changes"}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
