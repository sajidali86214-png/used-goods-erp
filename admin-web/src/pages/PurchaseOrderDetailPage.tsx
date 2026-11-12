import { useState, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

interface Account {
  id: string;
  label: string;
  kind: string;
}

interface Grade {
  id: string;
  code: string;
}
interface Product {
  id: string;
  skuCode: string;
  name: string;
}
interface POLine {
  id: string;
  productId: string;
  product: Product;
  gradeId: string | null;
  grade: Grade | null;
  orderedQty: string;
  unitPrice: string;
  discount: string | null;
  additionalCosts: string | null;
}
interface Supplier {
  id: string;
  name: string;
}
interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  currencyId: string;
  expectedReceiptDate: string | null;
  terms: string | null;
  notes: string | null;
  createdAt: string;
  supplier: Supplier;
  lines: POLine[];
}
interface POStatusLine {
  lineId: string;
  productId: string;
  orderedQty: string;
  receivedQty: string;
  rejectedQty: string;
  outstandingQty: string;
}
interface POStatus {
  status: string;
  lines: POStatusLine[];
  totalAdvance: string;
  totalMatchedAgainstInvoices: string;
  unappliedAdvance: string;
}
interface AmendmentEvent {
  id: string;
  entityId: string;
  reason: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  createdAt: string;
}

function lineTotal(l: { orderedQty: string; unitPrice: string; discount?: string | null; additionalCosts?: string | null }) {
  const gross = Number(l.orderedQty) * Number(l.unitPrice);
  return gross - Number(l.discount ?? 0) + Number(l.additionalCosts ?? 0);
}

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const po = useFetch<PurchaseOrder>(`/purchasing/orders/${id}`, [id]);
  const status = useFetch<POStatus>(`/purchasing/orders/${id}/status`, [id]);
  const amendments = useFetch<AmendmentEvent[]>(`/purchasing/orders/${id}/amendments`, [id]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [amendingLineId, setAmendingLineId] = useState<string | null>(null);

  if (po.loading) return <p>Loading...</p>;
  if (!po.data) return <p>Purchase order not found.</p>;
  const o = po.data;

  const statusByLine = new Map(status.data?.lines.map((l) => [l.lineId, l]) ?? []);
  const grandTotal = o.lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const totalPieces = o.lines.reduce((sum, l) => sum + Number(l.orderedQty), 0);

  function reloadAll() {
    po.reload();
    status.reload();
    amendments.reload();
  }

  async function handleApprove() {
    setError(null);
    try {
      await api.post(`/purchasing/orders/${id}/approve`);
      reloadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve PO");
    }
  }

  return (
    <div>
      <p>
        <Link to="/purchasing">← Back to purchasing</Link>
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>{o.poNumber}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {o.status === "draft" && has("stock.receive") && <button onClick={handleApprove}>Approve</button>}
          <button className="secondary" onClick={() => api.downloadFile(`/purchasing/orders/${id}/pdf`, `${o.poNumber}.pdf`)}>
            Download PDF
          </button>
        </div>
      </div>
      <p>
        {o.supplier.name} · <span className="badge">{o.status}</span> · created {new Date(o.createdAt).toLocaleDateString()}
        {o.expectedReceiptDate && <> · expected {new Date(o.expectedReceiptDate).toLocaleDateString()}</>}
      </p>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="panel">
        <h3>Lines</h3>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Grade</th>
              <th>Ordered</th>
              <th>Unit price</th>
              <th>Discount</th>
              <th>Extra costs</th>
              <th>Line total</th>
              <th>Received</th>
              <th>Rejected</th>
              <th>Outstanding</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {o.lines.map((line) => {
              const s = statusByLine.get(line.id);
              return (
                <PurchaseOrderLineRow
                  key={line.id}
                  line={line}
                  statusLine={s}
                  poStatus={o.status}
                  canEdit={has("stock.receive")}
                  editing={editingLineId === line.id}
                  amending={amendingLineId === line.id}
                  onStartEdit={() => setEditingLineId(line.id)}
                  onStartAmend={() => setAmendingLineId(line.id)}
                  onCancelEdit={() => {
                    setEditingLineId(null);
                    setAmendingLineId(null);
                  }}
                  onSaved={(msg) => {
                    setEditingLineId(null);
                    setAmendingLineId(null);
                    setSuccess(msg);
                    reloadAll();
                  }}
                  onError={setError}
                />
              );
            })}
          </tbody>
        </table>
        <p style={{ marginTop: 12 }}>
          <strong>Grand total: {grandTotal.toLocaleString()}</strong> ({totalPieces.toLocaleString()} pieces across {o.lines.length} line
          {o.lines.length === 1 ? "" : "s"})
        </p>
      </div>

      {status.data && (
        <div className="panel">
          <h3>Payment position</h3>
          <table>
            <tbody>
              <tr>
                <td>Advances paid to supplier</td>
                <td>{Number(status.data.totalAdvance).toLocaleString()}</td>
              </tr>
              <tr>
                <td>Matched against invoices</td>
                <td>{Number(status.data.totalMatchedAgainstInvoices).toLocaleString()}</td>
              </tr>
              <tr>
                <td>
                  <strong>Unapplied advance</strong>
                </td>
                <td>
                  <strong>{Number(status.data.unappliedAdvance).toLocaleString()}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Receiving stock never pays the supplier by itself — this is purely what's already on file for this PO. Already-paid advances shown
            above don't need to be re-entered below.
          </p>
          {has("finance.payment") && <SupplierPaymentForm poId={o.id} supplierId={o.supplier.id} currencyId={o.currencyId} onRecorded={reloadAll} />}
        </div>
      )}

      {o.terms && (
        <div className="panel">
          <h3>Terms</h3>
          <p>{o.terms}</p>
        </div>
      )}
      {o.notes && (
        <div className="panel">
          <h3>Notes</h3>
          <p>{o.notes}</p>
        </div>
      )}

      {amendments.data && amendments.data.length > 0 && (
        <div className="panel">
          <h3>Amendment history</h3>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Line</th>
                <th>Before</th>
                <th>After</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {amendments.data.map((a) => {
                const line = o.lines.find((l) => l.id === a.entityId);
                return (
                  <tr key={a.id}>
                    <td>{new Date(a.createdAt).toLocaleString()}</td>
                    <td>{line?.product.skuCode ?? a.entityId.slice(0, 8)}</td>
                    <td>{JSON.stringify(a.beforeJson)}</td>
                    <td>{JSON.stringify(a.afterJson)}</td>
                    <td>{a.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PurchaseOrderLineRow({
  line,
  statusLine,
  poStatus,
  canEdit,
  editing,
  amending,
  onStartEdit,
  onStartAmend,
  onCancelEdit,
  onSaved,
  onError,
}: {
  line: POLine;
  statusLine: POStatusLine | undefined;
  poStatus: string;
  canEdit: boolean;
  editing: boolean;
  amending: boolean;
  onStartEdit: () => void;
  onStartAmend: () => void;
  onCancelEdit: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [orderedQty, setOrderedQty] = useState(line.orderedQty);
  const [unitPrice, setUnitPrice] = useState(line.unitPrice);
  const [discount, setDiscount] = useState(line.discount ?? "");
  const [additionalCosts, setAdditionalCosts] = useState(line.additionalCosts ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSaveEdit() {
    setSaving(true);
    try {
      await api.patch(`/purchasing/orders/${line.id}/lines/${line.id}`, {
        orderedQty: Number(orderedQty),
        unitPrice: Number(unitPrice),
        discount: discount ? Number(discount) : undefined,
        additionalCosts: additionalCosts ? Number(additionalCosts) : undefined,
      });
      onSaved("Line updated.");
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not update line");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAmend() {
    setSaving(true);
    try {
      await api.post(`/purchasing/orders/${line.id}/lines/${line.id}/amend`, {
        orderedQty: Number(orderedQty) !== Number(line.orderedQty) ? Number(orderedQty) : undefined,
        unitPrice: Number(unitPrice) !== Number(line.unitPrice) ? Number(unitPrice) : undefined,
        reason,
      });
      onSaved("Amendment recorded.");
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not record amendment");
    } finally {
      setSaving(false);
    }
  }

  if (editing || amending) {
    return (
      <tr>
        <td colSpan={11}>
          <div className="panel" style={{ margin: "8px 0" }}>
            <h4 style={{ marginTop: 0 }}>
              {editing ? `Edit line — ${line.product.skuCode}` : `Amend line (audited) — ${line.product.skuCode}`}
            </h4>
            <div className="form-row">
              <div className="field" style={{ maxWidth: 140 }}>
                <label>Ordered quantity</label>
                <input type="number" min={1} value={orderedQty} onChange={(e) => setOrderedQty(e.target.value)} />
              </div>
              <div className="field" style={{ maxWidth: 140 }}>
                <label>Unit price</label>
                <input type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
              </div>
              {editing && (
                <>
                  <div className="field" style={{ maxWidth: 140 }}>
                    <label>Discount</label>
                    <input type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                  </div>
                  <div className="field" style={{ maxWidth: 140 }}>
                    <label>Additional costs</label>
                    <input type="number" min={0} step="0.01" value={additionalCosts} onChange={(e) => setAdditionalCosts(e.target.value)} />
                  </div>
                </>
              )}
            </div>
            {amending && (
              <div className="field">
                <label>Reason (required, audited)</label>
                <input value={reason} onChange={(e) => setReason(e.target.value)} required />
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={saving || (amending && !reason)} onClick={editing ? handleSaveEdit : handleSaveAmend}>
                {saving ? "Saving..." : "Save"}
              </button>
              <button type="button" className="secondary" onClick={onCancelEdit}>
                Cancel
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{line.product.skuCode}</td>
      <td>{line.grade?.code ?? "—"}</td>
      <td>{line.orderedQty}</td>
      <td>{Number(line.unitPrice).toLocaleString()}</td>
      <td>{Number(line.discount ?? 0).toLocaleString()}</td>
      <td>{Number(line.additionalCosts ?? 0).toLocaleString()}</td>
      <td>{lineTotal(line).toLocaleString()}</td>
      <td>{statusLine ? Number(statusLine.receivedQty).toLocaleString() : "—"}</td>
      <td>{statusLine ? Number(statusLine.rejectedQty).toLocaleString() : "—"}</td>
      <td>{statusLine ? Number(statusLine.outstandingQty).toLocaleString() : "—"}</td>
      <td>
        {canEdit && poStatus === "draft" && (
          <button className="secondary" onClick={onStartEdit}>
            Edit
          </button>
        )}
        {canEdit && poStatus !== "draft" && (
          <button className="secondary" onClick={onStartAmend}>
            Amend
          </button>
        )}
      </td>
    </tr>
  );
}

function SupplierPaymentForm({
  poId,
  supplierId,
  currencyId,
  onRecorded,
}: {
  poId: string;
  supplierId: string;
  currencyId: string;
  onRecorded: () => void;
}) {
  const accounts = useFetch<Account[]>("/settings/accounts");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethodAccountId, setPaymentMethodAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const advance = await api.post<{ id: string }>("/purchasing/advances", {
        supplierId,
        poId,
        currencyId,
        amount: Number(amount),
        paidAt: new Date(paidAt).toISOString(),
        paymentMethodAccountId,
        reference: reference || undefined,
      });
      await api.post(`/finance/post/supplier-advances/${advance.id}`);
      setSuccess("Payment recorded and posted — it's already linked to this PO, no need to re-enter it elsewhere.");
      setAmount("");
      setReference("");
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record payment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 12 }}>
      <h4 style={{ marginBottom: 6 }}>Record a payment</h4>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}
      <div className="form-row">
        <div className="field" style={{ maxWidth: 160 }}>
          <label>Amount</label>
          <input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div className="field" style={{ maxWidth: 220 }}>
          <label>Paying account</label>
          <select value={paymentMethodAccountId} onChange={(e) => setPaymentMethodAccountId(e.target.value)} required>
            <option value="">Select...</option>
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.kind})
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ maxWidth: 160 }}>
          <label>Date</label>
          <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
        </div>
        <div className="field" style={{ maxWidth: 200 }}>
          <label>Reference (optional)</label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>
      <button type="submit" disabled={submitting || !paymentMethodAccountId}>
        {submitting ? "Recording..." : "Record payment"}
      </button>
    </form>
  );
}
