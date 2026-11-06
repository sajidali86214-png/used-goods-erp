import { useEffect, useState } from "react";
import { NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const NAV_ITEMS: { to: string; label: string; permission?: string }[] = [
  { to: "/", label: "Dashboard" },
  { to: "/products", label: "Products" },
  { to: "/inventory", label: "Inventory", permission: "stock.count" },
  { to: "/suppliers", label: "Suppliers" },
  { to: "/purchasing", label: "Purchasing", permission: "stock.receive" },
  { to: "/sales", label: "Sales Orders", permission: "order.create" },
  { to: "/returns", label: "Returns & Refunds", permission: "return.process" },
  { to: "/finance", label: "Finance", permission: "finance.payment" },
  { to: "/reports", label: "Reports", permission: "profit.view" },
  { to: "/imports", label: "Bulk Import", permission: "settings.manage" },
  { to: "/users", label: "Users", permission: "user.manage" },
  { to: "/audit", label: "Audit Log", permission: "audit.view" },
  { to: "/settings", label: "Settings", permission: "settings.manage" },
];

export function Layout() {
  const { user, loading, logout, has } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  if (loading) return <div className="main">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;

  const visibleItems = NAV_ITEMS.filter((item) => !item.permission || has(item.permission));
  const currentTitle = visibleItems.find((item) => (item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to)))?.label ?? "Used Goods ERP";

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
          <span className="hamburger" />
        </button>
        <span className="topbar-title">{currentTitle}</span>
      </header>

      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}

      <aside className={`sidebar${drawerOpen ? " open" : ""}`}>
        <div className="brand">
          Used Goods ERP
          <button className="icon-button drawer-close" aria-label="Close menu" onClick={() => setDrawerOpen(false)}>
            ✕
          </button>
        </div>
        <nav>
          {visibleItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")} end={item.to === "/"}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="user-info">
          <div>{user.name}</div>
          <div>{user.roles.join(", ")}</div>
          <button className="secondary" style={{ marginTop: 8, width: "100%" }} onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
