import { useState, type FormEvent, Fragment } from "react";
import { useAuth } from "../auth/AuthContext";
import { useFetch } from "../api/useFetch";
import { useDebouncedValue } from "../api/useDebouncedValue";
import { api, ApiError } from "../api/client";
import { PhotoCapture, PhotoThumbnails, type UploadedPhoto } from "../components/PhotoCapture";

interface Product {
  id: string;
  skuCode: string;
  name: string;
  category: { name: string } | null;
  brand: { name: string } | null;
  defaultSellPrice: string | null;
  minPrice: string | null;
  isActive: boolean;
}

interface Category {
  id: string;
  name: string;
}

interface Brand {
  id: string;
  name: string;
}

export function ProductsPage() {
  const { has } = useAuth();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const products = useFetch<Product[]>(`/products${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ""}`, [debouncedSearch]);
  const categories = useFetch<Category[]>("/settings/categories");
  const brands = useFetch<Brand[]>("/settings/brands");

  const [expandedPhotosFor, setExpandedPhotosFor] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      // skuCode is assigned automatically from the category — never typed by hand.
      const created = await api.post<Product>("/products", {
        name,
        categoryId,
        brandId: brandId || undefined,
        minPrice: minPrice ? Number(minPrice) : undefined,
      });
      setSuccess(`Created "${created.name}" with SKU ${created.skuCode}.`);
      setName("");
      setBrandId("");
      setMinPrice("");
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
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            The SKU code is assigned automatically from the category (e.g. "BAGS-0001") — you don't type it.
          </p>
          {error && <div className="error-banner">{error}</div>}
          {success && <div className="success-banner">{success}</div>}
          <div className="form-row">
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
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
          </div>
          <div className="form-row">
            <div className="field">
              <label>Brand (optional)</label>
              <select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                <option value="">No brand</option>
                {brands.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Minimum price (optional)</label>
              <input type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} min={0} step="0.01" />
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
                <th>Brand</th>
                <th>Min price</th>
                <th>Status</th>
                <th>Photos</th>
              </tr>
            </thead>
            <tbody>
              {products.data.map((p) => (
                <Fragment key={p.id}>
                  <tr>
                    <td>{p.skuCode}</td>
                    <td>{p.name}</td>
                    <td>{p.category?.name ?? "—"}</td>
                    <td>{p.brand?.name ?? "—"}</td>
                    <td>{p.minPrice ?? "—"}</td>
                    <td>
                      <span className="badge">{p.isActive ? "active" : "archived"}</span>
                    </td>
                    <td>
                      <button className="secondary" onClick={() => setExpandedPhotosFor((cur) => (cur === p.id ? null : p.id))}>
                        {expandedPhotosFor === p.id ? "Hide" : "Photos"}
                      </button>
                    </td>
                  </tr>
                  {expandedPhotosFor === p.id && (
                    <tr>
                      <td colSpan={7}>
                        <ProductPhotoGallery productId={p.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

interface ProductPhotoRecord {
  id: string;
  url: string;
}

function ProductPhotoGallery({ productId }: { productId: string }) {
  const photos = useFetch<ProductPhotoRecord[]>(`/products/${productId}/photos`, [productId]);
  const [error, setError] = useState<string | null>(null);

  async function handleUploaded(photo: UploadedPhoto) {
    setError(null);
    try {
      await api.post(`/products/${productId}/photos`, { mediaAssetId: photo.id });
      photos.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not attach photo");
    }
  }

  async function handleRemove(photoId: string) {
    setError(null);
    try {
      await api.delete(`/products/${productId}/photos/${photoId}`);
      photos.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove photo");
    }
  }

  const thumbnails: UploadedPhoto[] = (photos.data ?? []).map((p) => ({ id: p.id, url: p.url }));

  return (
    <div style={{ padding: "8px 0" }}>
      {error && <div className="error-banner">{error}</div>}
      <PhotoThumbnails photos={thumbnails} onRemove={handleRemove} />
      {thumbnails.length === 0 && <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No photos yet.</p>}
      <div style={{ marginTop: 8 }}>
        <PhotoCapture kind="product" label="Add photo" onUploaded={handleUploaded} />
      </div>
    </div>
  );
}
