import { NavLink, Outlet, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const NAV_ITEMS: { to: string; label: string; permission?: string }[] = [
  { to: "/", label: "Dashboard" },
  { to: "/products", label: "Products" },
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

  if (loading) return <div className="main">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Used Goods ERP</div>
        <nav>
          {NAV_ITEMS.filter((item) => !item.permission || has(item.permission)).map((item) => (
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
