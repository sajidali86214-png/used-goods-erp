import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { api, ApiError } from "../api/client";

interface Grade {
  id: string;
  code: string;
}
interface Product {
  id: string;
  skuCode: string;
  name: string;
}
interface CostLayer {
  id: string;
  gradeId: string;
  grade: Grade;
  quantityRemaining: string;
  unitCost: string;
}
interface Lot {
  id: string;
  lotCode: string;
  sourceUnitPrice: string;
  costLayers: CostLayer[];
}
interface GRNLine {
  id: string;
  product: Product;
  grade: Grade | null;
  receivedQty: string;
  rejectedQty: string;
  inspectionNotes: string | null;
  poLine: { id: string; po: { id: string; poNumber: string } } | null;
  lots: Lot[];
}
interface GRN {
  id: string;
  grnNumber: string;
  receiptDate: string;
  deliveryReference: string | null;
  notes: string | null;
  createdAt: string;
  supplier: { id: string; name: string };
  lines: GRNLine[];
}

export function GRNDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { has } = useAuth();
  const grn = useFetch<GRN>(`/purchasing/grns/${id}`, [id]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyLineId, setBusyLineId] = useState<string | null>(null);

  if (grn.loading) return <p>Loading...</p>;
  if (!grn.data) return <p>GRN not found.</p>;
  const g = grn.data;

  async function handleReverse(lineId: string) {
    const reason = window.prompt(
      "Why is this line being reversed? (e.g. wrong quantity, wrong grade — this will be logged)",
    );
    if (!reason || !reason.trim()) return;
    setError(null);
    setSuccess(null);
    setBusyLineId(lineId);
    try {
      await api.post(`/purchasing/grn-lines/${lineId}/reverse`, { reason: reason.trim() });
      setSuccess("Line reversed — its stock impact has been fully undone. Re-receive it with the correct details from Purchasing.");
      grn.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reverse this line");
    } finally {
      setBusyLineId(null);
    }
  }

  const relatedPoIds = [...new Set(g.lines.map((l) => l.poLine?.po).filter(Boolean))] as { id: string; poNumber: string }[];
  const totalReceived = g.lines.reduce((sum, l) => sum + Number(l.receivedQty), 0);
  const totalRejected = g.lines.reduce((sum, l) => sum + Number(l.rejectedQty), 0);
  const stillUngraded = g.lines.filter((l) => !l.grade);

  return (
    <div>
      <p>
        <Link to="/purchasing">← Back to purchasing</Link>
      </p>
      <h1>{g.grnNumber}</h1>
      <p>
        {g.supplier.name} · received {new Date(g.receiptDate).toLocaleDateString()}
        {g.deliveryReference && <> · ref {g.deliveryReference}</>}
      </p>
      {relatedPoIds.length > 0 && (
        <p>
          Against:{" "}
          {relatedPoIds.map((po, i) => (
            <span key={po.id}>
              {i > 0 && ", "}
              <Link to={`/purchasing/${po.id}`}>{po.poNumber}</Link>
            </span>
          ))}
        </p>
      )}

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="panel">
        <h3>Lines</h3>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Grade received</th>
              <th>Received</th>
              <th>Rejected</th>
              <th>Lot</th>
              <th>Unit cost (landed)</th>
              <th>Remaining</th>
              {has("stock.receive") && <th></th>}
            </tr>
          </thead>
          <tbody>
            {g.lines.map((line) => {
              const remaining = line.lots
                .flatMap((lot) => lot.costLayers)
                .reduce((sum, cl) => sum + Number(cl.quantityRemaining), 0);
              const wasReversed = Number(line.receivedQty) === 0 && line.lots.length > 0;
              return (
                <tr key={line.id}>
                  <td>{line.product.skuCode}</td>
                  <td>
                    {line.grade ? <span className="badge">{line.grade.code}</span> : <span className="badge">Ungraded — awaiting inspection</span>}
                  </td>
                  <td>{Number(line.receivedQty).toLocaleString()}</td>
                  <td>{Number(line.rejectedQty).toLocaleString()}</td>
                  <td>{line.lots.map((lot) => lot.lotCode).join(", ") || "—"}</td>
                  <td>
                    {line.lots
                      .flatMap((lot) => lot.costLayers)
                      .map((cl) => Number(cl.unitCost).toLocaleString())
                      .join(", ") || "—"}
                  </td>
                  <td>{remaining.toLocaleString()}</td>
                  {has("stock.receive") && (
                    <td>
                      {wasReversed ? (
                        <span className="badge">Reversed</span>
                      ) : (
                        <button
                          className="secondary"
                          disabled={busyLineId === line.id}
                          onClick={() => handleReverse(line.id)}
                          title="Undo this line's entire stock impact so it can be re-received correctly. Only works if nothing has been graded, dispatched, or reserved from it yet."
                        >
                          {busyLineId === line.id ? "Reversing..." : "Reverse"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ marginTop: 12 }}>
          <strong>Total received: {totalReceived.toLocaleString()}</strong>
          {totalRejected > 0 && <> · rejected: {totalRejected.toLocaleString()}</>}
        </p>
      </div>

      {stillUngraded.length > 0 && (
        <div className="panel">
          <p>
            <strong>{stillUngraded.length} line(s) still awaiting inspection/grading.</strong> Open the Inventory page for{" "}
            {stillUngraded.map((l) => l.product.skuCode).join(", ")} and use "Grade transfer" to move them into saleable stock.
          </p>
        </div>
      )}

      {g.notes && (
        <div className="panel">
          <h3>Notes</h3>
          <p>{g.notes}</p>
        </div>
      )}
    </div>
  );
}
