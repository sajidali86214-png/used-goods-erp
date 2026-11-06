import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { useDebouncedValue } from "../api/useDebouncedValue";
import { api, ApiError } from "../api/client";
import { PhotoCapture, PhotoThumbnails, type UploadedPhoto } from "../components/PhotoCapture";

interface ProductStockRow {
  productId: string;
  skuCode: string;
  name: string;
  onHandQty: string;
  reservedQty: string;
  availableQty: string;
}

interface StockDetailRow {
  state: string;
  gradeId: string;
  gradeCode: string;
  binId: string;
  binCode: string;
  costLayerId: string;
  onHandQty: string;
  reservedQty: string;
  availableQty: string | null;
}

interface ProductStockDetail {
  productId: string;
  skuCode: string;
  name: string;
  rows: StockDetailRow[];
}

interface CostLayer {
  id: string;
  gradeId: string;
  binId: string;
  quantityRemaining: string;
  unitCost: string;
  grade: { code: string };
  bin: { code: string };
}

interface Grade {
  id: string;
  code: string;
  label: string;
}
interface Bin {
  id: string;
  code: string;
  label: string;
}

export function InventoryPage() {
  const { has } = useAuth();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const levels = useFetch<ProductStockRow[]>("/reports/stock-by-product");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  const filtered = (levels.data ?? []).filter((r) => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    return r.skuCode.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
  });

  return (
    <div>
      <h1>Inventory</h1>

      <div className="panel">
        <div className="field" style={{ maxWidth: 320 }}>
          <label>Search by SKU or name</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {levels.loading && <p>Loading...</p>}
        {levels.error && <div className="error-banner">{levels.error}</div>}
        {levels.data && (
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>On hand</th>
                <th>Reserved</th>
                <th>Available (saleable)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.productId}>
                  <td>{r.skuCode}</td>
                  <td>{r.name}</td>
                  <td>{Number(r.onHandQty).toLocaleString()}</td>
                  <td>{Number(r.reservedQty).toLocaleString()}</td>
                  <td>{Number(r.availableQty).toLocaleString()}</td>
                  <td>
                    <button className="secondary" onClick={() => setSelectedProductId(r.productId)}>
                      View breakdown
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6}>No products currently hold stock matching that search.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {selectedProductId && (
        <ProductStockDetailPanel
          productId={selectedProductId}
          canViewCost={has("cost.view")}
          canGradeTransfer={has("stock.grade")}
          canWriteOff={has("stock.writeoff")}
          canListIndividual={has("stock.transfer")}
          onClose={() => setSelectedProductId(null)}
          onChanged={() => levels.reload()}
        />
      )}
    </div>
  );
}

function ProductStockDetailPanel({
  productId,
  canViewCost,
  canGradeTransfer,
  canWriteOff,
  canListIndividual,
  onClose,
  onChanged,
}: {
  productId: string;
  canViewCost: boolean;
  canGradeTransfer: boolean;
  canWriteOff: boolean;
  canListIndividual: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useFetch<ProductStockDetail>(`/reports/stock-by-product/${productId}`, [productId]);
  const costLayers = useFetch<CostLayer[]>(canViewCost ? `/products/${productId}/cost-layers` : null, [productId, canViewCost]);
  const [showGradeTransfer, setShowGradeTransfer] = useState(false);
  const [showWriteOff, setShowWriteOff] = useState(false);
  const [showListIndividual, setShowListIndividual] = useState(false);

  const totalValue = (costLayers.data ?? []).reduce((sum, cl) => sum + Number(cl.quantityRemaining) * Number(cl.unitCost), 0);

  function reloadAll() {
    detail.reload();
    costLayers.reload();
    onChanged();
  }

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>
          {detail.data ? `${detail.data.skuCode} — ${detail.data.name}` : "Loading..."}
        </h3>
        <button className="secondary" onClick={onClose}>
          Close
        </button>
      </div>

      {detail.loading && <p>Loading...</p>}
      {detail.error && <div className="error-banner">{detail.error}</div>}
      {detail.data && (
        <table>
          <thead>
            <tr>
              <th>State</th>
              <th>Grade</th>
              <th>Bin</th>
              <th>On hand</th>
              <th>Reserved</th>
              <th>Available</th>
            </tr>
          </thead>
          <tbody>
            {detail.data.rows.map((r, i) => (
              <tr key={`${r.costLayerId}-${r.state}-${i}`}>
                <td>
                  <span className="badge">{r.state}</span>
                </td>
                <td>{r.gradeCode}</td>
                <td>{r.binCode}</td>
                <td>{Number(r.onHandQty).toLocaleString()}</td>
                <td>{Number(r.reservedQty).toLocaleString()}</td>
                <td>{r.availableQty !== null ? Number(r.availableQty).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {detail.data.rows.length === 0 && (
              <tr>
                <td colSpan={6}>No stock currently held for this product.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {canViewCost && costLayers.data && (
        <div style={{ marginTop: 12 }}>
          <h4>Cost layers &amp; valuation</h4>
          <table>
            <thead>
              <tr>
                <th>Lot grade</th>
                <th>Bin</th>
                <th>Qty remaining</th>
                <th>Unit cost</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {costLayers.data
                .filter((cl) => Number(cl.quantityRemaining) > 0)
                .map((cl) => (
                  <tr key={cl.id}>
                    <td>{cl.grade.code}</td>
                    <td>{cl.bin.code}</td>
                    <td>{Number(cl.quantityRemaining).toLocaleString()}</td>
                    <td>{Number(cl.unitCost).toLocaleString()}</td>
                    <td>{(Number(cl.quantityRemaining) * Number(cl.unitCost)).toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p style={{ fontWeight: 600 }}>Total value: {totalValue.toLocaleString()}</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {canGradeTransfer && (
          <button onClick={() => setShowGradeTransfer((v) => !v)}>{showGradeTransfer ? "Cancel" : "Grade transfer"}</button>
        )}
        {canWriteOff && <button onClick={() => setShowWriteOff((v) => !v)}>{showWriteOff ? "Cancel" : "Write off"}</button>}
        {canListIndividual && (
          <button onClick={() => setShowListIndividual((v) => !v)}>{showListIndividual ? "Cancel" : "List individual item"}</button>
        )}
      </div>

      {showGradeTransfer && (
        <GradeTransferForm
          costLayers={costLayers.data ?? []}
          onDone={() => {
            setShowGradeTransfer(false);
            reloadAll();
          }}
        />
      )}
      {showWriteOff && (
        <WriteOffForm
          detailRows={detail.data?.rows ?? []}
          onDone={() => {
            setShowWriteOff(false);
            reloadAll();
          }}
        />
      )}
      {showListIndividual && (
        <ListIndividualItemForm
          detailRows={detail.data?.rows ?? []}
          onDone={() => {
            setShowListIndividual(false);
            reloadAll();
          }}
        />
      )}
    </div>
  );
}

interface SplitRow {
  gradeId: string;
  binId: string;
  quantity: string;
}

function GradeTransferForm({ costLayers, onDone }: { costLayers: CostLayer[]; onDone: () => void }) {
  const grades = useFetch<Grade[]>("/settings/grades");
  const bins = useFetch<Bin[]>("/settings/bins");

  const [sourceCostLayerId, setSourceCostLayerId] = useState("");
  const [splits, setSplits] = useState<SplitRow[]>([{ gradeId: "", binId: "", quantity: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const sourceLayer = costLayers.find((cl) => cl.id === sourceCostLayerId);
  const sourceRemaining = sourceLayer ? Number(sourceLayer.quantityRemaining) : 0;
  const splitTotal = splits.reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);

  function updateSplit(index: number, patch: Partial<SplitRow>) {
    setSplits((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  function addSplit() {
    setSplits((prev) => [...prev, { gradeId: "", binId: "", quantity: "" }]);
  }
  function removeSplit(index: number) {
    setSplits((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (splitTotal !== sourceRemaining) {
      setError(`The split quantities (${splitTotal}) must add up to exactly the source layer's full remaining quantity (${sourceRemaining}) — grading always fully consumes the source.`);
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/stock/grade-transfer", {
        sourceCostLayerId,
        splits: splits.map((s) => ({ gradeId: s.gradeId, binId: s.binId, quantity: Number(s.quantity) })),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not transfer grade");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit} style={{ marginTop: 8 }}>
      <h4>Grade transfer</h4>
      <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
        Grading always consumes the ENTIRE source layer — split it fully across one or more destination grades/bins.
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="field">
        <label>Source cost layer</label>
        <select value={sourceCostLayerId} onChange={(e) => setSourceCostLayerId(e.target.value)} required>
          <option value="">Select...</option>
          {costLayers
            .filter((cl) => Number(cl.quantityRemaining) > 0)
            .map((cl) => (
              <option key={cl.id} value={cl.id}>
                {cl.grade.code} / {cl.bin.code} — {cl.quantityRemaining} remaining
              </option>
            ))}
        </select>
      </div>

      {splits.map((split, i) => (
        <div className="form-row" key={i}>
          <div className="field">
            <label>New grade</label>
            <select value={split.gradeId} onChange={(e) => updateSplit(i, { gradeId: e.target.value })} required>
              <option value="">Select...</option>
              {grades.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code} — {g.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Destination bin</label>
            <select value={split.binId} onChange={(e) => updateSplit(i, { binId: e.target.value })} required>
              <option value="">Select...</option>
              {bins.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Quantity</label>
            <input
              type="number"
              value={split.quantity}
              onChange={(e) => updateSplit(i, { quantity: e.target.value })}
              required
              min={1}
            />
          </div>
          {splits.length > 1 && (
            <button type="button" className="secondary" onClick={() => removeSplit(i)}>
              Remove
            </button>
          )}
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <button type="button" className="secondary" onClick={addSplit}>
          + Add another grade split
        </button>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Allocated {splitTotal} of {sourceRemaining}
        </span>
      </div>

      <button type="submit" disabled={submitting}>
        {submitting ? "Transferring..." : "Transfer"}
      </button>
    </form>
  );
}

function WriteOffForm({ detailRows, onDone }: { detailRows: StockDetailRow[]; onDone: () => void }) {
  const [costLayerId, setCostLayerId] = useState("");
  const [state, setState] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const rowsWithStock = detailRows.filter((r) => Number(r.onHandQty) > 0);

  function handleSelectRow(key: string) {
    const row = rowsWithStock.find((r) => `${r.costLayerId}:${r.state}` === key);
    if (row) {
      setCostLayerId(row.costLayerId);
      setState(row.state);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/stock/write-off", {
        costLayerId,
        state,
        quantity: Number(quantity),
        reason,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not write off stock");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit} style={{ marginTop: 8 }}>
      <h4>Write off</h4>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-row">
        <div className="field">
          <label>Stock line</label>
          <select onChange={(e) => handleSelectRow(e.target.value)} required defaultValue="">
            <option value="">Select...</option>
            {rowsWithStock.map((r) => (
              <option key={`${r.costLayerId}:${r.state}`} value={`${r.costLayerId}:${r.state}`}>
                {r.state} · {r.gradeCode} / {r.binCode} — {r.onHandQty} on hand
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Quantity to write off</label>
          <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} required min={1} />
        </div>
      </div>
      <div className="field">
        <label>Reason</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="e.g. damaged beyond repair, lost in warehouse" />
      </div>
      <button type="submit" disabled={submitting}>
        {submitting ? "Recording..." : "Write off"}
      </button>
    </form>
  );
}

function ListIndividualItemForm({ detailRows, onDone }: { detailRows: StockDetailRow[]; onDone: () => void }) {
  const [costLayerId, setCostLayerId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [binId, setBinId] = useState("");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Only saleable stock can be pulled out for an individual listing — that's
  // what separateForIndividualSale requires on the backend too.
  const saleableRows = detailRows.filter((r) => r.state === "saleable" && Number(r.onHandQty) > 0);

  function handleSelectRow(key: string) {
    const row = saleableRows.find((r) => r.costLayerId === key);
    if (row) {
      setCostLayerId(row.costLayerId);
      setGradeId(row.gradeId);
      setBinId(row.binId);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (photos.length === 0) {
      setError("At least one photo is required to list an individual item");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/stock/individual-items", {
        costLayerId,
        gradeId,
        binId,
        photoMediaAssetIds: photos.map((p) => p.id),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not list this item");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit} style={{ marginTop: 8 }}>
      <h4>List individual item</h4>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Pulls one piece out of the bulk saleable pool for an exact-item listing (e.g. Instagram) — same SKU, grade and cost, just tracked separately until it sells.
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div className="field">
        <label>Saleable stock line</label>
        <select onChange={(e) => handleSelectRow(e.target.value)} required defaultValue="">
          <option value="">Select...</option>
          {saleableRows.map((r) => (
            <option key={r.costLayerId} value={r.costLayerId}>
              {r.gradeCode} / {r.binCode} — {r.onHandQty} available
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Photos (required)</label>
        <PhotoCapture kind="individual_item" onUploaded={(p) => setPhotos((prev) => [...prev, p])} />
        <PhotoThumbnails photos={photos} onRemove={(id) => setPhotos((prev) => prev.filter((p) => p.id !== id))} />
      </div>
      <button type="submit" disabled={submitting} style={{ marginTop: 8 }}>
        {submitting ? "Listing..." : "List this item"}
      </button>
    </form>
  );
}
