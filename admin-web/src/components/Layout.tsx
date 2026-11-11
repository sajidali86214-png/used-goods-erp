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
  { to: "/investor", label: "Investor Dashboard", permission: "investor.dashboard.view" },
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

  // A restricted investor login sees only their own dashboard — nothing
  // else in the app, regardless of what other (unlisted) permissions a
  // plain "investor" role might ever pick up later.
  const isInvestorOnly = user.roles.length === 1 && user.roles[0] === "investor";
  const visibleItems = isInvestorOnly
    ? NAV_ITEMS.filter((item) => item.to === "/investor")
    : NAV_ITEMS.filter((item) => !item.permission || has(item.permission));
  const currentTitle = visibleItems.find((item) => (item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to)))?.label ?? "Used Goods ERP";

  // Belt-and-braces: even a direct URL (not just the hidden nav links) sends
  // an investor-only login back to their own dashboard.
  if (isInvestorOnly && location.pathname !== "/investor") {
    return <Navigate to="/investor" replace />;
  }

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
