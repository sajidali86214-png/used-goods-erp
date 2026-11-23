import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

interface PoLineRef {
  id: string;
  unitPrice: string;
}
interface GrnLineRef {
  id: string;
  receivedQty: string;
  product: { skuCode: string; name: string };
  poLine: PoLineRef | null;
}
interface InvoiceLine {
  id: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  varianceNotes: string | null;
  grnLine: GrnLineRef;
}
interface SupplierInvoiceDetail {
  id: string;
  supplier: { id: string; name: string };
  po: { id: string; poNumber: string } | null;
  amount: string;
  invoiceDate: string;
  dueDate: string | null;
  approvalStatus: string;
  approvedAt: string | null;
  hasVariance: boolean;
  isDisputed: boolean;
  lines: InvoiceLine[];
}

export function SupplierInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const invoice = useFetch<SupplierInvoiceDetail>(`/purchasing/invoices/${id}`, [id]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [showDispute, setShowDispute] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (invoice.loading) return <p>Loading...</p>;
  if (!invoice.data) return <p>Supplier invoice not found.</p>;
  const inv = invoice.data;

  async function handleApprove() {
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/purchasing/invoices/${id}/approve`);
      setSuccess("Invoice approved — Dr GRNI / Cr Accounts Payable posted.");
      invoice.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve invoice");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDispute() {
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/purchasing/invoices/${id}/dispute`, { reason: disputeReason });
      setSuccess("Invoice marked as disputed — it cannot be approved until this is resolved.");
      setShowDispute(false);
      setDisputeReason("");
      invoice.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not dispute invoice");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p>
        <Link to="/purchasing/invoices">← Back to supplier invoices</Link>
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Invoice — {inv.supplier.name}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {inv.approvalStatus === "pending_approval" && !inv.isDisputed && has("invoice.approve") && (
            <button onClick={handleApprove} disabled={submitting}>
              Approve
            </button>
          )}
          {inv.approvalStatus === "pending_approval" && !inv.isDisputed && has("finance.payment") && (
            <button className="secondary" onClick={() => setShowDispute((v) => !v)}>
              {showDispute ? "Cancel" : "Dispute"}
            </button>
          )}
        </div>
      </div>
      <p>
        {inv.po && <>PO {inv.po.poNumber} · </>}
        invoice date {new Date(inv.invoiceDate).toLocaleDateString()}
        {inv.dueDate && <> · due {new Date(inv.dueDate).toLocaleDateString()}</>}
      </p>
      <p>
        <span className="badge">{inv.approvalStatus}</span>
        {inv.hasVariance && <span className="badge" style={{ marginLeft: 6 }}>has variance</span>}
        {inv.isDisputed && <span className="badge" style={{ marginLeft: 6, background: "#b42318" }}>disputed</span>}
      </p>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      {showDispute && (
        <div className="panel">
          <h4 style={{ marginTop: 0 }}>Dispute this invoice</h4>
          <div className="field">
            <label>Reason (required, audited)</label>
            <input value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} required />
          </div>
          <button disabled={submitting || !disputeReason} onClick={handleDispute}>
            Confirm dispute
          </button>
        </div>
      )}

      <div className="panel">
        <h3>Three-way match</h3>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Received (GRN)</th>
              <th>PO price</th>
              <th>Invoiced qty</th>
              <th>Invoiced price</th>
              <th>Line amount</th>
              <th>Variance</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.grnLine.product.skuCode}</td>
                <td>{Number(line.grnLine.receivedQty).toLocaleString()}</td>
                <td>{line.grnLine.poLine ? Number(line.grnLine.poLine.unitPrice).toLocaleString() : "—"}</td>
                <td>{Number(line.quantity).toLocaleString()}</td>
                <td>{Number(line.unitPrice).toLocaleString()}</td>
                <td>{Number(line.amount).toLocaleString()}</td>
                <td>{line.varianceNotes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ marginTop: 12 }}>
          <strong>Invoice total: {Number(inv.amount).toLocaleString()}</strong>
        </p>
      </div>
    </div>
  );
}
