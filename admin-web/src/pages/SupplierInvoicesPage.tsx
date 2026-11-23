import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

interface Supplier {
  id: string;
  name: string;
  defaultCurrencyId: string;
}
interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  supplier: Supplier;
}
interface InvoiceLineSummary {
  id: string;
  amount: string;
}
interface SupplierInvoice {
  id: string;
  supplier: Supplier;
  po: { id: string; poNumber: string } | null;
  amount: string;
  invoiceDate: string;
  dueDate: string | null;
  approvalStatus: string;
  hasVariance: boolean;
  isDisputed: boolean;
  lines: InvoiceLineSummary[];
}
interface PoLineRef {
  id: string;
  unitPrice: string;
}
interface UninvoicedGrnLine {
  id: string;
  productId: string;
  product: { skuCode: string; name: string };
  receivedQty: string;
  poLine: PoLineRef | null;
}

function isOverdue(invoice: SupplierInvoice): boolean {
  return invoice.approvalStatus === "approved" && !invoice.isDisputed && !!invoice.dueDate && new Date(invoice.dueDate) < new Date();
}

export function SupplierInvoicesPage() {
  const { has } = useAuth();
  const invoices = useFetch<SupplierInvoice[]>("/purchasing/invoices");
  const suppliers = useFetch<Supplier[]>("/suppliers");
  const pos = useFetch<PurchaseOrder[]>("/purchasing/orders");

  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <h1>Supplier Invoices</h1>
      {error && <div className="error-banner">{error}</div>}

      {has("finance.payment") && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => {
              setShowNew((v) => !v);
              setError(null);
            }}
          >
            {showNew ? "Cancel" : "+ New invoice"}
          </button>
        </div>
      )}

      {showNew && (
        <NewInvoiceForm
          suppliers={suppliers.data ?? []}
          pos={pos.data ?? []}
          onCreated={() => {
            setShowNew(false);
            invoices.reload();
          }}
          onError={setError}
        />
      )}

      <div className="panel">
        {invoices.loading && <p>Loading...</p>}
        {invoices.data && invoices.data.length === 0 && <p style={{ color: "var(--text-muted)" }}>No supplier invoices recorded yet.</p>}
        {invoices.data && invoices.data.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>PO</th>
                <th>Invoice date</th>
                <th>Due date</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Match</th>
              </tr>
            </thead>
            <tbody>
              {invoices.data.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.supplier.name}</td>
                  <td>{inv.po?.poNumber ?? "—"}</td>
                  <td>{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                  <td>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"}</td>
                  <td>
                    <Link to={`/purchasing/invoices/${inv.id}`}>{Number(inv.amount).toLocaleString()}</Link>
                  </td>
                  <td>
                    <span className="badge">{inv.approvalStatus}</span>
                    {isOverdue(inv) && <span className="badge" style={{ marginLeft: 6, background: "#b42318" }}>overdue</span>}
                    {inv.isDisputed && <span className="badge" style={{ marginLeft: 6 }}>disputed</span>}
                  </td>
                  <td>{inv.hasVariance ? "Variance" : "Matched"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface NewInvoiceLine extends UninvoicedGrnLine {
  invoiceQuantity: string;
  invoiceUnitPrice: string;
}

function NewInvoiceForm({
  suppliers,
  pos,
  onCreated,
  onError,
}: {
  suppliers: Supplier[];
  pos: PurchaseOrder[];
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [poId, setPoId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [lines, setLines] = useState<NewInvoiceLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const posForSupplier = pos.filter((po) => po.supplier.id === supplierId);
  const selectedSupplier = suppliers.find((s) => s.id === supplierId);

  async function handleSelectPo(newPoId: string) {
    setPoId(newPoId);
    if (!newPoId) {
      setLines([]);
      return;
    }
    setLoadingLines(true);
    try {
      const grnLines = await api.get<UninvoicedGrnLine[]>(`/purchasing/orders/${newPoId}/uninvoiced-grn-lines`);
      setLines(
        grnLines.map((g) => ({
          ...g,
          invoiceQuantity: g.receivedQty,
          invoiceUnitPrice: g.poLine?.unitPrice ?? "",
        })),
      );
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not load uninvoiced GRN lines for this PO");
    } finally {
      setLoadingLines(false);
    }
  }

  function updateLine(index: number, patch: Partial<NewInvoiceLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const linesToSubmit = lines.filter((l) => Number(l.invoiceQuantity) > 0);
    if (linesToSubmit.length === 0) {
      onError("No lines with an invoiced quantity greater than zero.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/purchasing/invoices", {
        supplierId,
        poId,
        currencyId: selectedSupplier?.defaultCurrencyId,
        invoiceDate: new Date(invoiceDate).toISOString(),
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        lines: linesToSubmit.map((l) => ({
          grnLineId: l.id,
          quantity: Number(l.invoiceQuantity),
          unitPrice: Number(l.invoiceUnitPrice),
        })),
      });
      onCreated();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not create invoice");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h3 style={{ marginTop: 0 }}>New supplier invoice</h3>
      <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
        Each line is matched against a specific GRN line (and that GRN line's PO line, if any). Changing the quantity or price away from
        what was received/ordered is fine — it just flags the invoice for a closer look before approval, it never blocks creation.
      </p>
      <div className="form-row">
        <div className="field">
          <label>Supplier</label>
          <select
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              setPoId("");
              setLines([]);
            }}
            required
          >
            <option value="">Select...</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Purchase order</label>
          <select value={poId} onChange={(e) => handleSelectPo(e.target.value)} required disabled={!supplierId}>
            <option value="">Select...</option>
            {posForSupplier.map((po) => (
              <option key={po.id} value={po.id}>
                {po.poNumber}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Invoice date</label>
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
        </div>
        <div className="field">
          <label>Due date (optional)</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>

      {loadingLines && <p>Loading uninvoiced GRN lines...</p>}
      {!loadingLines && poId && lines.length === 0 && (
        <p style={{ color: "var(--text-muted)" }}>Every received line on this PO has already been invoiced.</p>
      )}

      {lines.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Received</th>
              <th>PO price</th>
              <th>Invoiced qty</th>
              <th>Invoiced price</th>
              <th>Line total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.id}>
                <td>{line.product.skuCode}</td>
                <td>{Number(line.receivedQty).toLocaleString()}</td>
                <td>{line.poLine ? Number(line.poLine.unitPrice).toLocaleString() : "—"}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    value={line.invoiceQuantity}
                    onChange={(e) => updateLine(index, { invoiceQuantity: e.target.value })}
                    style={{ maxWidth: 100 }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.invoiceUnitPrice}
                    onChange={(e) => updateLine(index, { invoiceUnitPrice: e.target.value })}
                    style={{ maxWidth: 100 }}
                  />
                </td>
                <td>{(Number(line.invoiceQuantity) * Number(line.invoiceUnitPrice) || 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button type="submit" disabled={submitting || lines.length === 0} style={{ marginTop: 12 }}>
        {submitting ? "Creating..." : "Create invoice"}
      </button>
    </form>
  );
}
