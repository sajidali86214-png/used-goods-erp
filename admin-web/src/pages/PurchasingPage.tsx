import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";
import { PhotoCapture, PhotoThumbnails, type UploadedPhoto } from "../components/PhotoCapture";
import { useDraft } from "../lib/useDraft";

interface Supplier {
  id: string;
  name: string;
  defaultCurrencyId: string;
}
interface Product {
  id: string;
  skuCode: string;
  name: string;
}
interface Grade {
  id: string;
  code: string;
  label: string;
}
interface POLine {
  id: string;
  productId: string;
  gradeId: string | null;
  grade: Grade | null;
  orderedQty: string;
  unitPrice: string;
}
interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  supplier: Supplier;
  lines: POLine[];
}

interface NewPOLine {
  productId: string;
  gradeId: string;
  orderedQty: string;
  unitPrice: string;
}

function emptyPOLine(): NewPOLine {
  return { productId: "", gradeId: "", orderedQty: "", unitPrice: "" };
}

interface NewPODraft {
  showNewPO: boolean;
  supplierId: string;
  lines: NewPOLine[];
}

function emptyPODraft(): NewPODraft {
  return { showNewPO: false, supplierId: "", lines: [emptyPOLine()] };
}

export function PurchasingPage() {
  const { has } = useAuth();
  const [tab, setTab] = useState<"orders" | "receive">("orders");
  const pos = useFetch<PurchaseOrder[]>("/purchasing/orders");
  const suppliers = useFetch<Supplier[]>("/suppliers");
  const products = useFetch<Product[]>("/products");
  const grades = useFetch<Grade[]>("/settings/grades");

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [draft, setDraft, clearDraft] = useDraft<NewPODraft>("new-po", emptyPODraft());
  const { showNewPO, supplierId, lines } = draft;

  const selectedSupplier = suppliers.data?.find((s) => s.id === supplierId);

  function setShowNewPO(update: boolean | ((prev: boolean) => boolean)) {
    setDraft((d) => ({ ...d, showNewPO: typeof update === "function" ? update(d.showNewPO) : update }));
  }

  function setSupplierId(value: string) {
    setDraft((d) => ({ ...d, supplierId: value }));
  }

  function updateLine(index: number, patch: Partial<NewPOLine>) {
    setDraft((d) => ({ ...d, lines: d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  }

  function addLine() {
    setDraft((d) => ({ ...d, lines: [...d.lines, emptyPOLine()] }));
  }

  function removeLine(index: number) {
    setDraft((d) => ({ ...d, lines: d.lines.length > 1 ? d.lines.filter((_, i) => i !== index) : d.lines }));
  }

  async function handleCreatePO(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await api.post<PurchaseOrder>("/purchasing/orders", {
        supplierId,
        currencyId: selectedSupplier?.defaultCurrencyId,
        lines: lines.map((l) => ({
          productId: l.productId,
          gradeId: l.gradeId || undefined,
          orderedQty: Number(l.orderedQty),
          unitPrice: Number(l.unitPrice),
        })),
      });
      clearDraft();
      setSuccessMessage(`Purchase order ${created.poNumber} created.`);
      pos.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create PO");
    }
  }

  async function handleApprove(id: string) {
    setError(null);
    try {
      await api.post(`/purchasing/orders/${id}/approve`);
      pos.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve PO");
    }
  }

  return (
    <div>
      <h1>Purchasing</h1>
      <div className="tabs">
        <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>
          Purchase Orders
        </button>
        <button className={tab === "receive" ? "active" : ""} onClick={() => setTab("receive")}>
          Receiving (GRN)
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {tab === "orders" && (
        <>
          {has("stock.receive") && (
            <div style={{ marginBottom: 12 }}>
              <button
                onClick={() => {
                  setShowNewPO((v) => !v);
                  setSuccessMessage(null);
                }}
              >
                {showNewPO ? "Cancel" : "+ New purchase order"}
              </button>
            </div>
          )}

          {successMessage && !showNewPO && <div className="panel success-banner">{successMessage}</div>}

          {showNewPO && (
            <form className="panel" onSubmit={handleCreatePO}>
              <h3>New purchase order</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 12 }}>The PO number is assigned automatically once created.</p>
              <div className="form-row">
                <div className="field">
                  <label>Supplier</label>
                  <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                    <option value="">Select...</option>
                    {suppliers.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p style={{ color: "var(--text-muted)", fontSize: 12 }}>Line items — add a grade mix when you already know what you're ordering (e.g. a supplier's pre-sorted AB or C bale).</p>
              {lines.map((line, index) => (
                <div className="form-row" key={index}>
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
                    <label>Grade mix</label>
                    <select value={line.gradeId} onChange={(e) => updateLine(index, { gradeId: e.target.value })}>
                      <option value="">Not specified yet</option>
                      {grades.data?.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Ordered quantity</label>
                    <input
                      type="number"
                      value={line.orderedQty}
                      onChange={(e) => updateLine(index, { orderedQty: e.target.value })}
                      required
                      min={1}
                    />
                  </div>
                  <div className="field">
                    <label>Unit price</label>
                    <input
                      type="number"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                      required
                      min={0}
                      step="0.01"
                    />
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
              ))}
              <div style={{ marginBottom: 12 }}>
                <button type="button" className="secondary" onClick={addLine}>
                  + Add line
                </button>
              </div>
              <button type="submit">Create PO</button>
            </form>
          )}

          <div className="panel">
            {pos.loading && <p>Loading...</p>}
            {pos.data && (
              <table>
                <thead>
                  <tr>
                    <th>PO #</th>
                    <th>Supplier</th>
                    <th>Status</th>
                    <th>Lines</th>
                    <th>Grade mix</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pos.data.map((po) => (
                    <tr key={po.id}>
                      <td>{po.poNumber}</td>
                      <td>{po.supplier.name}</td>
                      <td>
                        <span className="badge">{po.status}</span>
                      </td>
                      <td>{po.lines.length}</td>
                      <td>
                        {Array.from(new Set(po.lines.map((l) => l.grade?.code).filter(Boolean))).join(", ") || "—"}
                      </td>
                      <td style={{ display: "flex", gap: 6 }}>
                        {po.status === "draft" && has("stock.receive") && (
                          <button className="secondary" onClick={() => handleApprove(po.id)}>
                            Approve
                          </button>
                        )}
                        <button className="secondary" onClick={() => api.downloadFile(`/purchasing/orders/${po.id}/pdf`, `${po.poNumber}.pdf`)}>
                          Download PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === "receive" && (
        <ReceiveGrnForm pos={pos.data ?? []} products={products.data ?? []} grades={grades.data ?? []} onReceived={pos.reload} />
      )}
    </div>
  );
}

interface Bin {
  id: string;
  code: string;
  label: string;
}
interface Currency {
  id: string;
  code: string;
}

function ReceiveGrnForm({
  pos,
  products,
  grades,
  onReceived,
}: {
  pos: PurchaseOrder[];
  products: Product[];
  grades: Grade[];
  onReceived: () => void;
}) {
  const bins = useFetch<Bin[]>("/settings/bins");
  const currencies = useFetch<Currency[]>("/settings/currencies");

  const [poId, setPoId] = useState("");
  const [poLineId, setPoLineId] = useState("");
  const [productId, setProductId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [receivedQty, setReceivedQty] = useState("");
  const [binId, setBinId] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [sourceUnitPrice, setSourceUnitPrice] = useState("");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedPo = pos.find((p) => p.id === poId);

  function handleSelectPoLine(lineId: string) {
    setPoLineId(lineId);
    const line = selectedPo?.lines.find((l) => l.id === lineId);
    if (line) {
      setProductId(line.productId);
      setGradeId(line.gradeId ?? "");
      setSourceUnitPrice(line.unitPrice);
      setCurrencyId(selectedPo!.supplier.defaultCurrencyId);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const supplierId = selectedPo?.supplier.id;
      const grn = await api.post<{ grnNumber: string; lines: { id: string }[] }>("/purchasing/grns", {
        supplierId,
        receiptDate: new Date().toISOString(),
        lines: [{ poLineId: poLineId || undefined, productId, gradeId: gradeId || undefined, receivedQty: Number(receivedQty) }],
      });

      // Second step: actually land the receipt in inventory (creates the lot + cost layer).
      const result = await api.post<{ lot: { lotCode: string } }>("/stock/receive", {
        grnLineId: grn.lines[0]!.id,
        productId,
        gradeId: gradeId || undefined,
        supplierId,
        originalCurrencyId: currencyId,
        sourceUnitPrice: Number(sourceUnitPrice),
        exchangeRate: 1,
        quantity: Number(receivedQty),
        binId,
        lotCode: grn.grnNumber,
      });

      for (const photo of photos) {
        await api.post(`/products/${productId}/photos`, { mediaAssetId: photo.id });
      }

      const gradeLabel = grades.find((g) => g.id === gradeId)?.code;
      setSuccess(
        `Recorded as GRN ${grn.grnNumber}, received into inventory as lot ${result.lot.lotCode} — currently ${gradeLabel ?? "Ungraded"}/Inspection. Move it to saleable stock from the lot's detail view.` +
          (photos.length > 0 ? ` ${photos.length} photo(s) attached to the product.` : ""),
      );
      setReceivedQty("");
      setSourceUnitPrice("");
      setGradeId("");
      setPhotos([]);
      onReceived();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record receipt");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h3>Record a goods receipt (GRN)</h3>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}
      <p style={{ color: "var(--text-muted)", fontSize: 12 }}>The GRN number is assigned automatically once recorded.</p>
      <div className="form-row">
        <div className="field">
          <label>Against PO (optional)</label>
          <select
            value={poId}
            onChange={(e) => {
              setPoId(e.target.value);
              setPoLineId("");
            }}
          >
            <option value="">No PO (direct receipt)</option>
            {pos.map((po) => (
              <option key={po.id} value={po.id}>
                {po.poNumber} — {po.supplier.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {selectedPo && (
        <div className="field">
          <label>PO line</label>
          <select value={poLineId} onChange={(e) => handleSelectPoLine(e.target.value)}>
            <option value="">Select a line...</option>
            {selectedPo.lines.map((l) => (
              <option key={l.id} value={l.id}>
                {products.find((p) => p.id === l.productId)?.skuCode ?? l.productId} — ordered {l.orderedQty}
                {l.grade ? ` (${l.grade.code})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="form-row">
        <div className="field">
          <label>Product</label>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} required disabled={!!poLineId}>
            <option value="">Select...</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.skuCode} — {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Grade received</label>
          <select value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
            <option value="">Ungraded (needs inspection)</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Received quantity</label>
          <input type="number" value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} required min={1} />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label>Bin</label>
          <select value={binId} onChange={(e) => setBinId(e.target.value)} required>
            <option value="">Select...</option>
            {bins.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.label}
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
        <div className="field">
          <label>Unit price</label>
          <input type="number" value={sourceUnitPrice} onChange={(e) => setSourceUnitPrice(e.target.value)} required min={0} step="0.01" />
        </div>
      </div>
      <div className="field">
        <label>Photos (optional — condition/listing photos for this product)</label>
        <PhotoCapture kind="product" onUploaded={(p) => setPhotos((prev) => [...prev, p])} />
        <PhotoThumbnails photos={photos} onRemove={(id) => setPhotos((prev) => prev.filter((p) => p.id !== id))} />
      </div>
      <button type="submit" disabled={submitting}>
        {submitting ? "Recording..." : "Record receipt"}
      </button>
    </form>
  );
}
