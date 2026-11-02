import { useState } from "react";
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
interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  fulfilmentStatus: string;
  customer: { name: string };
  lines: OrderLine[];
  shipments: Shipment[];
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
      <h1>{o.orderNumber}</h1>
      <p>
        {o.customer.name} · <span className="badge">{o.status}</span> · <span className="badge">{o.fulfilmentStatus}</span>
      </p>
      {error && <div className="error-banner">{error}</div>}

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
