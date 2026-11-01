import { useState } from "react";
import { parseCsv } from "../lib/csv";
import { api, ApiError } from "../api/client";

type ImportKind = "products" | "suppliers" | "customers" | "opening-stock";

const TEMPLATES: Record<ImportKind, string> = {
  products: "skuCode,name,categoryId,unitOfMeasure,defaultSellPrice,minPrice",
  suppliers: "name,defaultCurrencyId,contactPerson,phone,email,address",
  customers: "name,contact,address,notes",
  "opening-stock": "skuCode,gradeCode,binCode,quantity,unitCost,currencyId,costIsEstimated,notes",
};

interface RowError {
  row: number;
  message: string;
}
interface ImportJobResult {
  status: string;
  resultSummary: { createdCount: number; skippedCount?: number; totalRows: number };
  errors: RowError[] | null;
}

export function ImportsPage() {
  const [kind, setKind] = useState<ImportKind>("products");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [allOrNothing, setAllOrNothing] = useState(true);
  const [result, setResult] = useState<ImportJobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setRows(parseCsv(text));
    };
    reader.readAsText(file);
  }

  function coerceRow(row: Record<string, string>): Record<string, unknown> {
    const coerced: Record<string, unknown> = { ...row };
    for (const numericField of ["defaultSellPrice", "minPrice", "quantity", "unitCost"]) {
      if (row[numericField]) coerced[numericField] = Number(row[numericField]);
      else delete coerced[numericField];
    }
    if (row.costIsEstimated !== undefined) coerced.costIsEstimated = row.costIsEstimated.toLowerCase() === "true";
    Object.keys(coerced).forEach((k) => {
      if (coerced[k] === "") delete coerced[k];
    });
    return coerced;
  }

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      const path = kind === "opening-stock" ? "/imports/opening-stock" : `/imports/${kind}`;
      const job = await api.post<ImportJobResult>(path, {
        fileRef: fileName || `manual-${Date.now()}.csv`,
        allOrNothing,
        rows: rows.map(coerceRow),
      });
      setResult(job);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>Bulk Import</h1>

      <div className="panel">
        <div className="form-row">
          <div className="field">
            <label>What are you importing?</label>
            <select value={kind} onChange={(e) => { setKind(e.target.value as ImportKind); setRows([]); setResult(null); }}>
              <option value="products">Products</option>
              <option value="suppliers">Suppliers</option>
              <option value="customers">Customers</option>
              <option value="opening-stock">Opening stock</option>
            </select>
          </div>
          <div className="field">
            <label>Mode</label>
            <select value={allOrNothing ? "all" : "partial"} onChange={(e) => setAllOrNothing(e.target.value === "all")}>
              <option value="all">All-or-nothing (recommended)</option>
              <option value="partial">Accept valid rows, skip the rest</option>
            </select>
          </div>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          CSV header for this type: <code>{TEMPLATES[kind]}</code>
        </p>
        <div className="field">
          <label>CSV file</label>
          <input type="file" accept=".csv" onChange={handleFile} />
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {rows.length > 0 && !result && (
        <div className="panel">
          <h3>Preview ({rows.length} rows)</h3>
          <table>
            <thead>
              <tr>
                {Object.keys(rows[0]!).map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((row, i) => (
                <tr key={i}>
                  {Object.values(row).map((v, j) => (
                    <td key={j}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 20 && <p style={{ color: "var(--text-muted)" }}>...and {rows.length - 20} more rows</p>}
          <button onClick={handleConfirm} disabled={submitting}>
            {submitting ? "Importing..." : `Confirm import of ${rows.length} rows`}
          </button>
        </div>
      )}

      {result && (
        <div className="panel">
          <h3>Import result: {result.status}</h3>
          {result.status === "failed" ? (
            <div className="error-banner">All-or-nothing import rejected — nothing was created. Fix the errors below and re-upload.</div>
          ) : (
            <div className="success-banner">
              Created {result.resultSummary.createdCount} of {result.resultSummary.totalRows} rows.
              {result.resultSummary.skippedCount ? ` Skipped ${result.resultSummary.skippedCount}.` : ""}
            </div>
          )}
          {result.errors && result.errors.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {result.errors.map((e, i) => (
                  <tr key={i}>
                    <td>{e.row}</td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
