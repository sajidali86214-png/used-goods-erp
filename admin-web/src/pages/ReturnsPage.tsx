import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

interface ReturnLine {
  id: string;
  orderLineId: string;
  quantity: string;
  originGradeId: string;
  disposition: string | null;
  originUncertain: boolean;
}
interface ReturnRequest {
  id: string;
  status: string;
  order: { id: string; orderNumber: string; customer: { name: string } };
  lines: ReturnLine[];
}
interface SalesOrderSummary {
  id: string;
  orderNumber: string;
}
interface Grade {
  id: string;
  code: string;
  label: string;
}
interface OrderDetailLine {
  id: string;
  product: { skuCode: string };
  pickAllocations: { id: string; costLayerId: string; gradeId: string; binId: string; pickedQty: string }[];
}

export function ReturnsPage() {
  const { has } = useAuth();
  const returns = useFetch<ReturnRequest[]>("/sales/returns");
  const orders = useFetch<SalesOrderSummary[]>("/sales/orders");
  const grades = useFetch<Grade[]>("/settings/grades");

  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState("");
  const [creating, setCreating] = useState(false);

  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null);
  const selectedReturn = returns.data?.find((r) => r.id === selectedReturnId);
  const orderDetail = useFetch<{ lines: OrderDetailLine[] }>(
    selectedReturn ? `/sales/orders/${selectedReturn.order.id}` : null,
    [selectedReturn?.order.id],
  );

  async function handleCreateReturn(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await api.post("/sales/returns", { orderId });
      setOrderId("");
      returns.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create return request");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h1>Returns & Refunds</h1>
      {error && <div className="error-banner">{error}</div>}

      {has("return.process") && (
        <form className="panel" onSubmit={handleCreateReturn}>
          <h3>Start a return</h3>
          <div className="form-row">
            <div className="field">
              <label>Order</label>
              <select value={orderId} onChange={(e) => setOrderId(e.target.value)} required>
                <option value="">Select...</option>
                {orders.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNumber}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button type="submit" disabled={creating}>
            {creating ? "Creating..." : "Create return request"}
          </button>
        </form>
      )}

      <div className="panel">
        {returns.data && (
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Lines</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {returns.data.map((r) => (
                <tr key={r.id}>
                  <td>{r.order.orderNumber}</td>
                  <td>{r.order.customer.name}</td>
                  <td>
                    <span className="badge">{r.status}</span>
                  </td>
                  <td>{r.lines.length}</td>
                  <td>
                    <button className="secondary" onClick={() => setSelectedReturnId(r.id === selectedReturnId ? null : r.id)}>
                      {r.id === selectedReturnId ? "Close" : "Manage"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedReturnId && (
        <ReceiveAndInspect
          returnRequestId={selectedReturnId}
          orderLines={orderDetail.data?.lines ?? []}
          grades={grades.data ?? []}
          existingLines={returns.data?.find((r) => r.id === selectedReturnId)?.lines ?? []}
          onChanged={returns.reload}
        />
      )}
    </div>
  );
}

function ReceiveAndInspect({
  returnRequestId,
  orderLines,
  grades,
  existingLines,
  onChanged,
}: {
  returnRequestId: string;
  orderLines: OrderDetailLine[];
  grades: Grade[];
  existingLines: ReturnLine[];
  onChanged: () => void;
}) {
  const [orderLineId, setOrderLineId] = useState("");
  const [pickId, setPickId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [originUncertain, setOriginUncertain] = useState(false);
  const [assumptionNotes, setAssumptionNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedOrderLine = orderLines.find((l) => l.id === orderLineId);
  const selectedPick = selectedOrderLine?.pickAllocations.find((p) => p.id === pickId);

  async function handleReceive(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await api.post("/sales/returns/lines", {
        returnRequestId,
        orderLineId,
        costLayerId: selectedPick?.costLayerId,
        sourcePickAllocationId: originUncertain ? undefined : pickId,
        originGradeId: selectedPick?.gradeId,
        quantity: Number(quantity),
        originUncertain,
        assumptionNotes: assumptionNotes || undefined,
      });
      setSuccess("Return line received into inspection.");
      setQuantity("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not receive return");
    }
  }

  async function handleInspect(lineId: string, inspectedGradeId: string, qty: number, disposition: string) {
    setError(null);
    try {
      await api.post(`/sales/returns/lines/${lineId}/inspect`, {
        outcomes: [{ inspectedGradeId, quantity: qty, disposition }],
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not inspect return line");
    }
  }

  return (
    <div className="panel">
      <h3>Receive a return</h3>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}
      <form onSubmit={handleReceive}>
        <div className="form-row">
          <div className="field">
            <label>Order line</label>
            <select value={orderLineId} onChange={(e) => { setOrderLineId(e.target.value); setPickId(""); }} required>
              <option value="">Select...</option>
              {orderLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.product.skuCode}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Origin uncertain?</label>
            <select value={originUncertain ? "yes" : "no"} onChange={(e) => setOriginUncertain(e.target.value === "yes")}>
              <option value="no">No — known dispatch</option>
              <option value="yes">Yes — multi-lot, origin unclear</option>
            </select>
          </div>
        </div>
        {!originUncertain && selectedOrderLine && (
          <div className="field">
            <label>Which dispatched pick?</label>
            <select value={pickId} onChange={(e) => setPickId(e.target.value)} required>
              <option value="">Select...</option>
              {selectedOrderLine.pickAllocations.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id.slice(0, 8)} — picked {p.pickedQty}
                </option>
              ))}
            </select>
          </div>
        )}
        {originUncertain && selectedOrderLine && (
          <>
            <div className="field">
              <label>Approved assumption: which lot/pick to attribute this to</label>
              <select value={pickId} onChange={(e) => setPickId(e.target.value)} required>
                <option value="">Select...</option>
                {selectedOrderLine.pickAllocations.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id.slice(0, 8)} — picked {p.pickedQty}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Assumption notes (required)</label>
              <input value={assumptionNotes} onChange={(e) => setAssumptionNotes(e.target.value)} required placeholder="e.g. multi-lot dispatch, assumed FIFO" />
            </div>
          </>
        )}
        <div className="field">
          <label>Quantity returned</label>
          <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} required min={1} />
        </div>
        <button type="submit">Receive into inspection</button>
      </form>

      {existingLines.length > 0 && (
        <>
          <h3 style={{ marginTop: 20 }}>Lines awaiting inspection</h3>
          <table>
            <thead>
              <tr>
                <th>Qty</th>
                <th>Origin grade</th>
                <th>Status</th>
                <th>Inspect as...</th>
              </tr>
            </thead>
            <tbody>
              {existingLines.map((line) => (
                <tr key={line.id}>
                  <td>{line.quantity}</td>
                  <td>{grades.find((g) => g.id === line.originGradeId)?.code ?? "—"}</td>
                  <td>{line.disposition ? <span className="badge">{line.disposition}</span> : "pending"}</td>
                  <td>
                    {!line.disposition && (
                      <InspectForm
                        grades={grades}
                        onSubmit={(gradeId, disposition) => handleInspect(line.id, gradeId, Number(line.quantity), disposition)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function InspectForm({ grades, onSubmit }: { grades: Grade[]; onSubmit: (gradeId: string, disposition: string) => void }) {
  const [gradeId, setGradeId] = useState("");
  const [disposition, setDisposition] = useState("resaleable");
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <select value={gradeId} onChange={(e) => setGradeId(e.target.value)} style={{ width: 90 }}>
        <option value="">Grade...</option>
        {grades.map((g) => (
          <option key={g.id} value={g.id}>
            {g.code}
          </option>
        ))}
      </select>
      <select value={disposition} onChange={(e) => setDisposition(e.target.value)} style={{ width: 110 }}>
        <option value="resaleable">resaleable</option>
        <option value="repair">repair</option>
        <option value="damaged">damaged</option>
      </select>
      <button className="secondary" disabled={!gradeId} onClick={() => onSubmit(gradeId, disposition)}>
        Confirm
      </button>
    </div>
  );
}
