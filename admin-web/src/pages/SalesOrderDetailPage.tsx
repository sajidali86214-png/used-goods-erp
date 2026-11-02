import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (order.loading) return <p>Loading...</p>;
  if (!order.data) return <p>Order not found.</p>;
  const o = order.data;

  function alreadyPicked(line: OrderLine): number {
    return line.pickAllocations.reduce((sum, p) => sum + Number(p.pickedQty), 0);
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
            {line.gradeRequirementType !== "none" && remaining > 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
                Restricted/exact-composition lines need the allowed grade(s) chosen per pick — use the API directly for now (POST /sales/reservations and /sales/picks with a specific gradeId).
              </p>
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
