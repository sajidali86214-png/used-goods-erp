import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

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
interface POLine {
  id: string;
  productId: string;
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

export function PurchasingPage() {
  const { has } = useAuth();
  const [tab, setTab] = useState<"orders" | "receive">("orders");
  const pos = useFetch<PurchaseOrder[]>("/purchasing/orders");
  const suppliers = useFetch<Supplier[]>("/suppliers");
  const products = useFetch<Product[]>("/products");

  const [error, setError] = useState<string | null>(null);
  const [showNewPO, setShowNewPO] = useState(false);
  const [poNumber, setPoNumber] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [productId, setProductId] = useState("");
  const [orderedQty, setOrderedQty] = useState("");
  const [unitPrice, setUnitPrice] = useState("");

  const selectedSupplier = suppliers.data?.find((s) => s.id === supplierId);

  async function handleCreatePO(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/purchasing/orders", {
        poNumber,
        supplierId,
        currencyId: selectedSupplier?.defaultCurrencyId,
        lines: [{ productId, orderedQty: Number(orderedQty), unitPrice: Number(unitPrice) }],
      });
      setShowNewPO(false);
      setPoNumber("");
      setOrderedQty("");
      setUnitPrice("");
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
              <button onClick={() => setShowNewPO((v) => !v)}>{showNewPO ? "Cancel" : "+ New purchase order"}</button>
            </div>
          )}

          {showNewPO && (
            <form className="panel" onSubmit={handleCreatePO}>
              <h3>New purchase order</h3>
              <div className="form-row">
                <div className="field">
                  <label>PO number</label>
                  <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} required />
                </div>
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
              <p style={{ color: "var(--text-muted)", fontSize: 12 }}>First line item (add more lines via the API for now):</p>
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
                  <label>Ordered quantity</label>
                  <input type="number" value={orderedQty} onChange={(e) => setOrderedQty(e.target.value)} required min={1} />
                </div>
                <div className="field">
                  <label>Unit price</label>
                  <input type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} required min={0} />
                </div>
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
                        {po.status === "draft" && has("stock.receive") && (
                          <button className="secondary" onClick={() => handleApprove(po.id)}>
                            Approve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === "receive" && <ReceiveGrnForm pos={pos.data ?? []} products={products.data ?? []} onReceived={pos.reload} />}
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

function ReceiveGrnForm({ pos, products, onReceived }: { pos: PurchaseOrder[]; products: Product[]; onReceived: () => void }) {
  const bins = useFetch<Bin[]>("/settings/bins");
  const currencies = useFetch<Currency[]>("/settings/currencies");

  const [grnNumber, setGrnNumber] = useState("");
  const [poId, setPoId] = useState("");
  const [poLineId, setPoLineId] = useState("");
  const [productId, setProductId] = useState("");
  const [receivedQty, setReceivedQty] = useState("");
  const [binId, setBinId] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [sourceUnitPrice, setSourceUnitPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedPo = pos.find((p) => p.id === poId);

  function handleSelectPoLine(lineId: string) {
    setPoLineId(lineId);
    const line = selectedPo?.lines.find((l) => l.id === lineId);
    if (line) {
      setProductId(line.productId);
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
      const grn = await api.post<{ lines: { id: string }[] }>("/purchasing/grns", {
        grnNumber,
        supplierId,
        receiptDate: new Date().toISOString(),
        lines: [{ poLineId: poLineId || undefined, productId, receivedQty: Number(receivedQty) }],
      });

      // Second step: actually land the receipt in inventory (creates the lot + cost layer).
      const result = await api.post<{ lot: { lotCode: string } }>("/stock/receive", {
        grnLineId: grn.lines[0]!.id,
        productId,
        supplierId,
        originalCurrencyId: currencyId,
        sourceUnitPrice: Number(sourceUnitPrice),
        exchangeRate: 1,
        quantity: Number(receivedQty),
        binId,
        lotCode: grnNumber,
      });

      setSuccess(`Received into inventory as lot ${result.lot.lotCode} — currently Ungraded/Inspection. Grade it from the lot's detail view.`);
      setGrnNumber("");
      setReceivedQty("");
      setSourceUnitPrice("");
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
      <div className="form-row">
        <div className="field">
          <label>GRN number</label>
          <input value={grnNumber} onChange={(e) => setGrnNumber(e.target.value)} required />
        </div>
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
          <input type="number" value={sourceUnitPrice} onChange={(e) => setSourceUnitPrice(e.target.value)} required min={0} />
        </div>
      </div>
      <button type="submit" disabled={submitting}>
        {submitting ? "Recording..." : "Record receipt"}
      </button>
    </form>
  );
}
