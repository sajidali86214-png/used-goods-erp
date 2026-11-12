import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { useDebouncedValue } from "../api/useDebouncedValue";
import { api, ApiError } from "../api/client";
import { PhotoCapture, PhotoThumbnails, type UploadedPhoto } from "../components/PhotoCapture";
import { downloadCsv, toCsv } from "../lib/csv";

interface GradeBreakdownEntry {
  gradeCode: string;
  qty: string;
}
interface InventoryOverviewRow {
  productId: string;
  skuCode: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  onHandQty: string;
  availableQty: string;
  reservedQty: string;
  inspectionQty: string;
  gradeBreakdown: GradeBreakdownEntry[];
  avgUnitCost: string | null;
  totalValue: string | null;
}
interface InventoryOverview {
  rows: InventoryOverviewRow[];
  totals: { onHandQty: string; availableQty: string; reservedQty: string; inspectionQty: string; totalValue: string | null };
}
interface Category {
  id: string;
  name: string;
}
interface BrandOption {
  id: string;
  name: string;
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

const ALL = "";
type StockStatusFilter = "" | "available" | "awaiting_inspection" | "reserved";

export function InventoryPage() {
  const { has } = useAuth();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [categoryId, setCategoryId] = useState(ALL);
  const [brandId, setBrandId] = useState(ALL);
  const [gradeId, setGradeId] = useState(ALL);
  const [stockStatus, setStockStatus] = useState<StockStatusFilter>(ALL);

  const categories = useFetch<Category[]>("/settings/categories");
  const brands = useFetch<BrandOption[]>("/settings/brands");
  const grades = useFetch<Grade[]>("/settings/grades");

  const query = new URLSearchParams();
  if (debouncedSearch) query.set("search", debouncedSearch);
  if (categoryId) query.set("categoryId", categoryId);
  if (brandId) query.set("brandId", brandId);
  if (gradeId) query.set("gradeId", gradeId);
  if (stockStatus) query.set("stockStatus", stockStatus);
  const queryString = query.toString();

  const overview = useFetch<InventoryOverview>(
    `/reports/inventory-overview${queryString ? `?${queryString}` : ""}`,
    [debouncedSearch, categoryId, brandId, gradeId, stockStatus],
  );
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  // Clearing a selection that no longer matches anything (e.g. brand changed
  // after category) keeps filters simple — nothing to reconcile manually.
  const brandsInCategory = categoryId
    ? new Set((overview.data?.rows ?? []).filter((r) => r.categoryId === categoryId).map((r) => r.brandId))
    : null;

  function resetFilters() {
    setSearch("");
    setCategoryId(ALL);
    setBrandId(ALL);
    setGradeId(ALL);
    setStockStatus(ALL);
  }

  const activeFilterCount = [debouncedSearch, categoryId, brandId, gradeId, stockStatus].filter(Boolean).length;

  function handleDownload() {
    const rows = overview.data?.rows ?? [];
    const columns: { header: string; value: (r: InventoryOverviewRow) => string | number }[] = [
      { header: "SKU", value: (r) => r.skuCode },
      { header: "Name", value: (r) => r.name },
      { header: "Category", value: (r) => r.categoryName ?? "" },
      { header: "Brand", value: (r) => r.brandName ?? "" },
      { header: "On hand", value: (r) => r.onHandQty },
      { header: "Available", value: (r) => r.availableQty },
      { header: "Reserved", value: (r) => r.reservedQty },
      { header: "Awaiting inspection", value: (r) => r.inspectionQty },
      { header: "Grade breakdown", value: (r) => r.gradeBreakdown.map((g) => `${g.gradeCode}:${g.qty}`).join(" ") },
    ];
    if (has("cost.view")) {
      columns.push(
        { header: "Avg unit cost", value: (r) => r.avgUnitCost ?? "" },
        { header: "Total value", value: (r) => r.totalValue ?? "" },
      );
    }
    downloadCsv(`inventory-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, columns));
  }

  return (
    <div>
      <h1>Inventory</h1>

      <div className="panel">
        <div className="form-row">
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Search by SKU or name</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="field">
            <label>Category</label>
            <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setBrandId(ALL); }}>
              <option value={ALL}>All</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Brand</label>
            <select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value={ALL}>All</option>
              {brands.data
                ?.filter((b) => !brandsInCategory || brandsInCategory.has(b.id))
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label>Grade</label>
            <select value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
              <option value={ALL}>All</option>
              {grades.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Stock status</label>
            <select value={stockStatus} onChange={(e) => setStockStatus(e.target.value as StockStatusFilter)}>
              <option value={ALL}>All</option>
              <option value="available">Available to sell</option>
              <option value="awaiting_inspection">Awaiting inspection</option>
              <option value="reserved">Has reserved stock</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
            {activeFilterCount > 0 ? `${activeFilterCount} filter(s) active` : "Showing all products"}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            {activeFilterCount > 0 && (
              <button className="secondary" onClick={resetFilters}>
                Reset filters
              </button>
            )}
            <button className="secondary" onClick={handleDownload} disabled={!overview.data?.rows.length}>
              Download CSV
            </button>
          </div>
        </div>

        {overview.loading && <p>Loading...</p>}
        {overview.error && <div className="error-banner">{overview.error}</div>}
        {overview.data && (
          <>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Brand</th>
                  <th>On hand</th>
                  <th>Available</th>
                  <th>Reserved</th>
                  <th>Inspection</th>
                  <th>Grades</th>
                  {has("cost.view") && <th>Avg cost</th>}
                  {has("cost.view") && <th>Value</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {overview.data.rows.map((r) => (
                  <tr key={r.productId}>
                    <td>{r.skuCode}</td>
                    <td>{r.name}</td>
                    <td>{r.categoryName ?? "—"}</td>
                    <td>{r.brandName ?? "—"}</td>
                    <td>{Number(r.onHandQty).toLocaleString()}</td>
                    <td>{Number(r.availableQty).toLocaleString()}</td>
                    <td>{Number(r.reservedQty).toLocaleString()}</td>
                    <td>{Number(r.inspectionQty) > 0 ? Number(r.inspectionQty).toLocaleString() : "—"}</td>
                    <td style={{ fontSize: 12 }}>
                      {r.gradeBreakdown.map((g) => `${g.gradeCode}: ${Number(g.qty).toLocaleString()}`).join(", ")}
                    </td>
                    {has("cost.view") && <td>{r.avgUnitCost ? Number(r.avgUnitCost).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</td>}
                    {has("cost.view") && <td>{r.totalValue ? Number(r.totalValue).toLocaleString() : "—"}</td>}
                    <td>
                      <button className="secondary" onClick={() => setSelectedProductId(r.productId)}>
                        View breakdown
                      </button>
                    </td>
                  </tr>
                ))}
                {overview.data.rows.length === 0 && (
                  <tr>
                    <td colSpan={has("cost.view") ? 11 : 9}>No products currently hold stock matching these filters.</td>
                  </tr>
                )}
              </tbody>
              {overview.data.rows.length > 0 && (
                <tfoot>
                  <tr style={{ fontWeight: 600 }}>
                    <td colSpan={4}>Totals for this selection</td>
                    <td>{Number(overview.data.totals.onHandQty).toLocaleString()}</td>
                    <td>{Number(overview.data.totals.availableQty).toLocaleString()}</td>
                    <td>{Number(overview.data.totals.reservedQty).toLocaleString()}</td>
                    <td>{Number(overview.data.totals.inspectionQty).toLocaleString()}</td>
                    <td></td>
                    {has("cost.view") && <td></td>}
                    {has("cost.view") && <td>{overview.data.totals.totalValue ? Number(overview.data.totals.totalValue).toLocaleString() : "—"}</td>}
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </>
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
          onChanged={() => overview.reload()}
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
