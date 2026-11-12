import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
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
interface Category {
  id: string;
  name: string;
}
interface Brand {
  id: string;
  name: string;
}
interface Currency {
  id: string;
  code: string;
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
interface GRNSummary {
  id: string;
  grnNumber: string;
  receiptDate: string;
  supplier: Supplier;
  lines: { receivedQty: string }[];
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
  const grns = useFetch<GRNSummary[]>("/purchasing/grns");
  const suppliers = useFetch<Supplier[]>("/suppliers");
  const products = useFetch<Product[]>("/products");
  const grades = useFetch<Grade[]>("/settings/grades");
  const categories = useFetch<Category[]>("/settings/categories");
  const brands = useFetch<Brand[]>("/settings/brands");
  const currencies = useFetch<Currency[]>("/settings/currencies");

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [draft, setDraft, clearDraft] = useDraft<NewPODraft>("new-po", emptyPODraft());
  const { showNewPO, supplierId, lines } = draft;

  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newProductForLine, setNewProductForLine] = useState<number | null>(null);

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
                  <div style={{ display: "flex", gap: 6 }}>
                    <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required style={{ flex: 1 }}>
                      <option value="">Select...</option>
                      {suppliers.data?.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="secondary" onClick={() => setShowNewSupplier((v) => !v)}>
                      {showNewSupplier ? "Cancel" : "+ New"}
                    </button>
                  </div>
                </div>
              </div>

              {showNewSupplier && (
                <NewSupplierPanel
                  currencies={currencies.data ?? []}
                  onCreated={(supplier) => {
                    suppliers.reload();
                    setSupplierId(supplier.id);
                    setShowNewSupplier(false);
                  }}
                  onCancel={() => setShowNewSupplier(false)}
                />
              )}

              <p style={{ color: "var(--text-muted)", fontSize: 12 }}>Line items — add a grade mix when you already know what you're ordering (e.g. a supplier's pre-sorted AB or C bale).</p>
              {lines.map((line, index) => (
                <div key={index}>
                <div className="form-row">
                  <div className="field">
                    <label>Product</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <select
                        value={line.productId}
                        onChange={(e) => updateLine(index, { productId: e.target.value })}
                        required
                        style={{ flex: 1 }}
                      >
                        <option value="">Select...</option>
                        {products.data?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.skuCode} — {p.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="secondary" onClick={() => setNewProductForLine((v) => (v === index ? null : index))}>
                        {newProductForLine === index ? "Cancel" : "+ New"}
                      </button>
                    </div>
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
                  <div className="field" style={{ maxWidth: 140 }}>
                    <label>Line total</label>
                    <p style={{ margin: "6px 0", fontWeight: 600 }}>
                      {(Number(line.orderedQty) * Number(line.unitPrice) || 0).toLocaleString()}
                    </p>
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
                {newProductForLine === index && (
                  <NewProductPanel
                    categories={categories.data ?? []}
                    brands={brands.data ?? []}
                    onCreated={(product) => {
                      products.reload();
                      updateLine(index, { productId: product.id });
                      setNewProductForLine(null);
                    }}
                    onCancel={() => setNewProductForLine(null)}
                  />
                )}
                </div>
              ))}
              <div style={{ marginBottom: 12 }}>
                <button type="button" className="secondary" onClick={addLine}>
                  + Add line
                </button>
              </div>
              <p style={{ fontSize: 15, marginBottom: 12 }}>
                <strong>
                  Grand total: {lines.reduce((sum, l) => sum + (Number(l.orderedQty) * Number(l.unitPrice) || 0), 0).toLocaleString()}
                </strong>{" "}
                ({lines.reduce((sum, l) => sum + (Number(l.orderedQty) || 0), 0).toLocaleString()} pieces across {lines.length} line
                {lines.length === 1 ? "" : "s"})
              </p>
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
                    <th>Pieces</th>
                    <th>Amount</th>
                    <th>Grade mix</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pos.data.map((po) => (
                    <tr key={po.id}>
                      <td>
                        <Link to={`/purchasing/${po.id}`}>{po.poNumber}</Link>
                      </td>
                      <td>{po.supplier.name}</td>
                      <td>
                        <span className="badge">{po.status}</span>
                      </td>
                      <td>{po.lines.length}</td>
                      <td>{po.lines.reduce((sum, l) => sum + Number(l.orderedQty), 0).toLocaleString()}</td>
                      <td>{po.lines.reduce((sum, l) => sum + Number(l.orderedQty) * Number(l.unitPrice), 0).toLocaleString()}</td>
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
        <>
          <ReceiveGrnForm
            pos={pos.data ?? []}
            products={products.data ?? []}
            grades={grades.data ?? []}
            categories={categories.data ?? []}
            brands={brands.data ?? []}
            onReceived={() => {
              pos.reload();
              grns.reload();
            }}
            onProductCreated={products.reload}
          />
          <div className="panel">
            <h3>Goods receipts (GRNs)</h3>
            {grns.data && grns.data.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>GRN #</th>
                    <th>Supplier</th>
                    <th>Date</th>
                    <th>Lines</th>
                    <th>Pieces</th>
                  </tr>
                </thead>
                <tbody>
                  {grns.data.map((g) => (
                    <tr key={g.id}>
                      <td>
                        <Link to={`/grns/${g.id}`}>{g.grnNumber}</Link>
                      </td>
                      <td>{g.supplier.name}</td>
                      <td>{new Date(g.receiptDate).toLocaleDateString()}</td>
                      <td>{g.lines.length}</td>
                      <td>{g.lines.reduce((sum, l) => sum + Number(l.receivedQty), 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {grns.data && grns.data.length === 0 && <p style={{ color: "var(--text-muted)" }}>No goods receipts recorded yet.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function NewSupplierPanel({
  currencies,
  onCreated,
  onCancel,
}: {
  currencies: Currency[];
  onCreated: (supplier: Supplier) => void;
  onCancel: () => void;
}) {
  const pkr = currencies.find((c) => c.code === "PKR");
  const [name, setName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [defaultCurrencyId, setDefaultCurrencyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const created = await api.post<Supplier>("/suppliers", {
        name,
        defaultCurrencyId: defaultCurrencyId || pkr?.id,
        contactPerson: contactPerson || undefined,
        phone: phone || undefined,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create supplier");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <h4 style={{ marginTop: 0 }}>New supplier</h4>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-row">
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label>Contact person</label>
          <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
        </div>
        <div className="field">
          <label>Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label>Currency</label>
          <select value={defaultCurrencyId} onChange={(e) => setDefaultCurrencyId(e.target.value)}>
            <option value="">{pkr ? `${pkr.code} (default)` : "Select..."}</option>
            {currencies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={saving || !name} onClick={handleSave}>
          {saving ? "Saving..." : "Save supplier"}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function NewProductPanel({
  categories,
  brands,
  onCreated,
  onCancel,
}: {
  categories: Category[];
  brands: Brand[];
  onCreated: (product: Product) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const created = await api.post<Product>("/products", {
        name,
        categoryId,
        brandId: brandId || undefined,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create product");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <h4 style={{ marginTop: 0 }}>New product</h4>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>The SKU code is assigned automatically from the category.</p>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-row">
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label>Category</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="">Select...</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Brand (optional)</label>
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">No brand</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={saving || !name || !categoryId} onClick={handleSave}>
          {saving ? "Saving..." : "Save product"}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

interface Bin {
  id: string;
  code: string;
  label: string;
}
interface PoStatusLine {
  lineId: string;
  productId: string;
  gradeId: string | null;
  orderedQty: string;
  receivedQty: string;
  outstandingQty: string;
}

interface ReceiveLine {
  poLineId: string | null;
  productId: string;
  gradeId: string;
  receivedQty: string;
  unitPrice: string;
}

function emptyReceiveLine(): ReceiveLine {
  return { poLineId: null, productId: "", gradeId: "", receivedQty: "", unitPrice: "" };
}

interface ReceiveGrnDraft {
  poId: string;
  binId: string;
  currencyId: string;
  lines: ReceiveLine[];
}

function emptyReceiveDraft(): ReceiveGrnDraft {
  return { poId: "", binId: "", currencyId: "", lines: [emptyReceiveLine()] };
}

function ReceiveGrnForm({
  pos,
  products,
  grades,
  categories,
  brands,
  onReceived,
  onProductCreated,
}: {
  pos: PurchaseOrder[];
  products: Product[];
  grades: Grade[];
  categories: Category[];
  brands: Brand[];
  onReceived: () => void;
  onProductCreated: () => void;
}) {
  const bins = useFetch<Bin[]>("/settings/bins");
  const currencies = useFetch<Currency[]>("/settings/currencies");

  const [draft, setDraft, clearDraft] = useDraft<ReceiveGrnDraft>("receive-grn", emptyReceiveDraft());
  const { poId, binId, currencyId, lines } = draft;
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingPoLines, setLoadingPoLines] = useState(false);
  const [newProductForLine, setNewProductForLine] = useState<number | null>(null);

  const selectedPo = pos.find((p) => p.id === poId);

  function setBinId(v: string) {
    setDraft((d) => ({ ...d, binId: v }));
  }
  function setCurrencyId(v: string) {
    setDraft((d) => ({ ...d, currencyId: v }));
  }
  function updateLine(index: number, patch: Partial<ReceiveLine>) {
    setDraft((d) => ({ ...d, lines: d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
  }
  function addLine() {
    setDraft((d) => ({ ...d, lines: [...d.lines, emptyReceiveLine()] }));
  }
  function removeLine(index: number) {
    setDraft((d) => ({ ...d, lines: d.lines.length > 1 ? d.lines.filter((_, i) => i !== index) : d.lines }));
  }

  // Selecting an approved PO pulls in every outstanding line automatically,
  // pre-filled with grade/price from the PO and the remaining qty to
  // receive — no more picking lines one at a time.
  async function handleSelectPo(newPoId: string) {
    if (!newPoId) {
      setDraft((d) => ({ ...d, poId: "", lines: [emptyReceiveLine()] }));
      return;
    }
    const po = pos.find((p) => p.id === newPoId);
    setLoadingPoLines(true);
    setError(null);
    try {
      const status = await api.get<{ lines: PoStatusLine[] }>(`/purchasing/orders/${newPoId}/status`);
      const outstandingLines = status.lines.filter((l) => Number(l.outstandingQty) > 0);
      const newLines: ReceiveLine[] = outstandingLines.map((sl) => {
        const poLine = po?.lines.find((l) => l.id === sl.lineId);
        return {
          poLineId: sl.lineId,
          productId: sl.productId,
          gradeId: poLine?.gradeId ?? "",
          receivedQty: sl.outstandingQty,
          unitPrice: poLine?.unitPrice ?? "",
        };
      });
      setDraft((d) => ({
        ...d,
        poId: newPoId,
        currencyId: po?.supplier.defaultCurrencyId ?? d.currencyId,
        lines: newLines.length > 0 ? newLines : [emptyReceiveLine()],
      }));
      if (outstandingLines.length === 0) {
        setError("This PO has nothing left outstanding to receive.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this PO's lines");
    } finally {
      setLoadingPoLines(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const supplierId = selectedPo?.supplier.id;
      const linesToReceive = lines.filter((l) => l.productId && Number(l.receivedQty) > 0);
      if (linesToReceive.length === 0) throw new Error("No lines with a received quantity greater than zero.");

      const grn = await api.post<{ grnNumber: string; lines: { id: string }[] }>("/purchasing/grns", {
        supplierId,
        receiptDate: new Date().toISOString(),
        lines: linesToReceive.map((l) => ({
          poLineId: l.poLineId ?? undefined,
          productId: l.productId,
          gradeId: l.gradeId || undefined,
          receivedQty: Number(l.receivedQty),
        })),
      });

      // Second step per line: actually land each receipt in inventory (creates the lot + cost layer).
      for (let i = 0; i < linesToReceive.length; i++) {
        const l = linesToReceive[i]!;
        await api.post("/stock/receive", {
          grnLineId: grn.lines[i]!.id,
          productId: l.productId,
          gradeId: l.gradeId || undefined,
          supplierId,
          originalCurrencyId: currencyId,
          sourceUnitPrice: Number(l.unitPrice) || 0,
          exchangeRate: 1,
          quantity: Number(l.receivedQty),
          binId,
          lotCode: `${grn.grnNumber}-${i + 1}`,
        });
      }

      const distinctProductIds = [...new Set(linesToReceive.map((l) => l.productId))];
      for (const photo of photos) {
        for (const pid of distinctProductIds) {
          await api.post(`/products/${pid}/photos`, { mediaAssetId: photo.id });
        }
      }

      setSuccess(
        `Recorded as GRN ${grn.grnNumber} — ${linesToReceive.length} line(s) received into inventory, currently in Inspection. Move them to saleable stock from each lot's detail view.` +
          (photos.length > 0 ? ` ${photos.length} photo(s) attached.` : ""),
      );
      clearDraft();
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
          <label>Against PO (optional) — picks up every outstanding line automatically</label>
          <select value={poId} onChange={(e) => handleSelectPo(e.target.value)} disabled={loadingPoLines}>
            <option value="">No PO (direct receipt)</option>
            {pos
              .filter((po) => po.status === "approved")
              .map((po) => (
                <option key={po.id} value={po.id}>
                  {po.poNumber} — {po.supplier.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      {loadingPoLines && <p>Loading PO lines...</p>}

      {lines.map((line, index) => (
        <div key={index}>
        <div className="form-row">
          <div className="field">
            <label>Product</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select
                value={line.productId}
                onChange={(e) => updateLine(index, { productId: e.target.value })}
                required
                disabled={!!line.poLineId}
                style={{ flex: 1 }}
              >
                <option value="">Select...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.skuCode} — {p.name}
                  </option>
                ))}
              </select>
              {!line.poLineId && (
                <button type="button" className="secondary" onClick={() => setNewProductForLine((v) => (v === index ? null : index))}>
                  {newProductForLine === index ? "Cancel" : "+ New"}
                </button>
              )}
            </div>
          </div>
          <div className="field">
            <label>Grade received</label>
            <select value={line.gradeId} onChange={(e) => updateLine(index, { gradeId: e.target.value })}>
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
            <input
              type="number"
              value={line.receivedQty}
              onChange={(e) => updateLine(index, { receivedQty: e.target.value })}
              min={0}
            />
          </div>
          <div className="field">
            <label>Unit price</label>
            <input
              type="number"
              value={line.unitPrice}
              onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
              min={0}
              step="0.01"
            />
          </div>
          <div className="field" style={{ maxWidth: 140 }}>
            <label>Line total</label>
            <p style={{ margin: "6px 0", fontWeight: 600 }}>
              {(Number(line.receivedQty) * Number(line.unitPrice) || 0).toLocaleString()}
            </p>
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
        {newProductForLine === index && (
          <NewProductPanel
            categories={categories}
            brands={brands}
            onCreated={(product) => {
              onProductCreated();
              updateLine(index, { productId: product.id });
              setNewProductForLine(null);
            }}
            onCancel={() => setNewProductForLine(null)}
          />
        )}
        </div>
      ))}
      <div style={{ marginBottom: 12 }}>
        <button type="button" className="secondary" onClick={addLine}>
          + Add line
        </button>
      </div>
      <p style={{ fontSize: 15, marginBottom: 12 }}>
        <strong>
          Grand total: {lines.reduce((sum, l) => sum + (Number(l.receivedQty) * Number(l.unitPrice) || 0), 0).toLocaleString()}
        </strong>{" "}
        ({lines.reduce((sum, l) => sum + (Number(l.receivedQty) || 0), 0).toLocaleString()} pieces across {lines.length} line
        {lines.length === 1 ? "" : "s"})
      </p>

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
      </div>
      <div className="field">
        <label>Photos (optional — condition/listing photos for this receipt)</label>
        <PhotoCapture kind="product" onUploaded={(p) => setPhotos((prev) => [...prev, p])} />
        <PhotoThumbnails photos={photos} onRemove={(id) => setPhotos((prev) => prev.filter((p) => p.id !== id))} />
      </div>
      <button type="submit" disabled={submitting}>
        {submitting ? "Recording..." : "Record receipt"}
      </button>
    </form>
  );
}
