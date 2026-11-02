import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { useDebouncedValue } from "../api/useDebouncedValue";
import { api, ApiError } from "../api/client";

interface Product {
  id: string;
  skuCode: string;
  name: string;
  category: { name: string } | null;
  defaultSellPrice: string | null;
  minPrice: string | null;
  isActive: boolean;
}

interface Category {
  id: string;
  name: string;
}

export function ProductsPage() {
  const { has } = useAuth();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const products = useFetch<Product[]>(`/products${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ""}`, [debouncedSearch]);
  const categories = useFetch<Category[]>("/settings/categories");

  const [showForm, setShowForm] = useState(false);
  const [skuCode, setSkuCode] = useState("");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/products", {
        skuCode,
        name,
        categoryId,
        minPrice: minPrice ? Number(minPrice) : undefined,
      });
      setSkuCode("");
      setName("");
      setMinPrice("");
      setShowForm(false);
      products.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create product");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Products</h1>
        {has("settings.manage") && (
          <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ Add product"}</button>
        )}
      </div>

      {showForm && (
        <form className="panel" onSubmit={handleCreate}>
          <h3>New product</h3>
          {error && <div className="error-banner">{error}</div>}
          <div className="form-row">
            <div className="field">
              <label>SKU code</label>
              <input value={skuCode} onChange={(e) => setSkuCode(e.target.value)} required />
            </div>
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>Category</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                <option value="">Select a category...</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Minimum price (optional)</label>
              <input type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} min={0} />
            </div>
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create product"}
          </button>
        </form>
      )}

      <div className="panel">
        <div className="field" style={{ maxWidth: 320 }}>
          <label>Search by SKU or name</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. jeans or SKU-123" />
        </div>
        {products.loading && <p>Loading...</p>}
        {products.error && <div className="error-banner">{products.error}</div>}
        {products.data && (
          <>
            {products.data.length === 200 && (
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Showing the first 200 matches — refine your search to narrow further.</p>
            )}
            <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Category</th>
                <th>Min price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {products.data.map((p) => (
                <tr key={p.id}>
                  <td>{p.skuCode}</td>
                  <td>{p.name}</td>
                  <td>{p.category?.name ?? "—"}</td>
                  <td>{p.minPrice ?? "—"}</td>
                  <td>
                    <span className="badge">{p.isActive ? "active" : "archived"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
