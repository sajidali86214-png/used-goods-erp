import { useParams, Link } from "react-router-dom";
import { useFetch } from "../api/useFetch";

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
  const grn = useFetch<GRN>(`/purchasing/grns/${id}`, [id]);

  if (grn.loading) return <p>Loading...</p>;
  if (!grn.data) return <p>GRN not found.</p>;
  const g = grn.data;

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
            </tr>
          </thead>
          <tbody>
            {g.lines.map((line) => (
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
                <td>
                  {line.lots
                    .flatMap((lot) => lot.costLayers)
                    .reduce((sum, cl) => sum + Number(cl.quantityRemaining), 0)
                    .toLocaleString()}
                </td>
              </tr>
            ))}
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
