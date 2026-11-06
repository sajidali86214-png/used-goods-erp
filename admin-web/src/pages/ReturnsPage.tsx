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
interface Refund {
  id: string;
  amount: string;
  currencyId: string;
  status: string;
  returnRequestId: string | null;
}
interface OrderDetail {
  lines: OrderDetailLine[];
  refunds: Refund[];
}
interface Currency {
  id: string;
  code: string;
}
interface Account {
  id: string;
  label: string;
}

export function ReturnsPage() {
  const { has } = useAuth();
  const returns = useFetch<ReturnRequest[]>("/sales/returns");
  const orders = useFetch<SalesOrderSummary[]>("/sales/orders");
  const grades = useFetch<Grade[]>("/settings/grades");
  const currencies = useFetch<Currency[]>("/settings/currencies");
  const accounts = useFetch<Account[]>("/settings/accounts");

  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState("");
  const [creating, setCreating] = useState(false);

  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null);
  const selectedReturn = returns.data?.find((r) => r.id === selectedReturnId);
  const orderDetail = useFetch<OrderDetail>(
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

      {selectedReturn && (
        <>
          <ReceiveAndInspect
            returnRequestId={selectedReturn.id}
            orderLines={orderDetail.data?.lines ?? []}
            grades={grades.data ?? []}
            existingLines={selectedReturn.lines}
            onChanged={() => {
              returns.reload();
              orderDetail.reload();
            }}
          />
          <RefundPanel
            orderId={selectedReturn.order.id}
            returnRequestId={selectedReturn.id}
            refunds={orderDetail.data?.refunds ?? []}
            currencies={currencies.data ?? []}
            accounts={accounts.data ?? []}
            onChanged={orderDetail.reload}
          />
        </>
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

  async function handleInspect(lineId: string, outcomes: { gradeId: string; quantity: number; disposition: string }[]) {
    setError(null);
    try {
      await api.post(`/sales/returns/lines/${lineId}/inspect`, {
        outcomes: outcomes.map((o) => ({ inspectedGradeId: o.gradeId, quantity: o.quantity, disposition: o.disposition })),
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
                <th>Inspect</th>
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
                        totalQuantity={Number(line.quantity)}
                        grades={grades}
                        onSubmit={(outcomes) => handleInspect(line.id, outcomes)}
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

interface OutcomeRow {
  gradeId: string;
  quantity: string;
  disposition: string;
}

/**
 * Supports splitting one returned quantity across multiple outcomes — e.g.
 * spec's worked example: 5 Grade A pieces return, 3 stay A and 2 become B.
 * The sum of outcome quantities must equal the line's full quantity before
 * submitting is allowed (the backend enforces this too; this just surfaces
 * the mismatch before the round trip).
 */
function InspectForm({
  totalQuantity,
  grades,
  onSubmit,
}: {
  totalQuantity: number;
  grades: Grade[];
  onSubmit: (outcomes: { gradeId: string; quantity: number; disposition: string }[]) => void;
}) {
  const [rows, setRows] = useState<OutcomeRow[]>([{ gradeId: "", quantity: String(totalQuantity), disposition: "resaleable" }]);

  const sum = rows.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);
  const balanced = sum === totalQuantity;
  const allGraded = rows.every((r) => r.gradeId);

  function updateRow(i: number, patch: Partial<OutcomeRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const remaining = Math.max(0, totalQuantity - sum);
    setRows((prev) => [...prev, { gradeId: "", quantity: String(remaining), disposition: "resaleable" }]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <select value={row.gradeId} onChange={(e) => updateRow(i, { gradeId: e.target.value })} style={{ width: 90 }}>
            <option value="">Grade...</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={row.quantity}
            onChange={(e) => updateRow(i, { quantity: e.target.value })}
            style={{ width: 60 }}
            min={1}
          />
          <select value={row.disposition} onChange={(e) => updateRow(i, { disposition: e.target.value })} style={{ width: 100 }}>
            <option value="resaleable">resaleable</option>
            <option value="repair">repair</option>
            <option value="damaged">damaged</option>
          </select>
          {rows.length > 1 && (
            <button type="button" className="secondary" onClick={() => removeRow(i)}>
              ×
            </button>
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button type="button" className="secondary" onClick={addRow}>
          + Split into another grade
        </button>
        <span style={{ fontSize: 12, color: balanced ? "var(--success)" : "var(--danger)" }}>
          {sum} / {totalQuantity}
        </span>
      </div>
      <button
        type="button"
        disabled={!balanced || !allGraded}
        style={{ marginTop: 6 }}
        onClick={() => onSubmit(rows.map((r) => ({ gradeId: r.gradeId, quantity: Number(r.quantity), disposition: r.disposition })))}
      >
        Confirm inspection
      </button>
    </div>
  );
}

function RefundPanel({
  orderId,
  returnRequestId,
  refunds,
  currencies,
  accounts,
  onChanged,
}: {
  orderId: string;
  returnRequestId: string;
  refunds: Refund[];
  currencies: Currency[];
  accounts: Account[];
  onChanged: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await api.post("/sales/refunds", { orderId, returnRequestId, amount: Number(amount), currencyId });
      setAmount("");
      setSuccess("Refund recorded as pending.");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create refund");
    }
  }

  async function handleMarkPaid(refundId: string, accountId: string) {
    setError(null);
    try {
      await api.post(`/sales/refunds/${refundId}/mark-paid`, { paymentMethodAccountId: accountId });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark refund paid");
    }
  }

  const relevantRefunds = refunds.filter((r) => r.returnRequestId === returnRequestId);

  return (
    <div className="panel">
      <h3>Refund</h3>
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}
      <form onSubmit={handleCreate} className="form-row" style={{ alignItems: "flex-end" }}>
        <div className="field">
          <label>Amount</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required min={0} step="0.01" />
        </div>
        <div className="field">
          <label>Currency</label>
          <select value={currencyId} onChange={(e) => setCurrencyId(e.target.value)} required>
            <option value="">Select...</option>
            {currencies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" style={{ height: 36 }}>
          Record refund
        </button>
      </form>

      {relevantRefunds.length > 0 && (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Amount</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {relevantRefunds.map((r) => (
              <tr key={r.id}>
                <td>{r.amount}</td>
                <td>
                  <span className="badge">{r.status}</span>
                </td>
                <td>{r.status !== "refunded" && <MarkPaidControl accounts={accounts} onConfirm={(accountId) => handleMarkPaid(r.id, accountId)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MarkPaidControl({ accounts, onConfirm }: { accounts: Account[]; onConfirm: (accountId: string) => void }) {
  const [accountId, setAccountId] = useState("");
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ width: 140 }}>
        <option value="">Paid from...</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
      <button className="secondary" disabled={!accountId} onClick={() => onConfirm(accountId)}>
        Mark paid
      </button>
    </div>
  );
}
