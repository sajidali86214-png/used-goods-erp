import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProductsPage } from "./pages/ProductsPage";
import { InventoryPage } from "./pages/InventoryPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { PurchasingPage } from "./pages/PurchasingPage";
import { SalesOrdersPage } from "./pages/SalesOrdersPage";
import { SalesOrderDetailPage } from "./pages/SalesOrderDetailPage";
import { CustomerDetailPage } from "./pages/CustomerDetailPage";
import { ReturnsPage } from "./pages/ReturnsPage";
import { FinancePage } from "./pages/FinancePage";
import { ReportsPage } from "./pages/ReportsPage";
import { ImportsPage } from "./pages/ImportsPage";
import { UsersPage } from "./pages/UsersPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="suppliers" element={<SuppliersPage />} />
            <Route path="purchasing" element={<PurchasingPage />} />
            <Route path="sales" element={<SalesOrdersPage />} />
            <Route path="sales/:id" element={<SalesOrderDetailPage />} />
            <Route path="customers/:id" element={<CustomerDetailPage />} />
            <Route path="returns" element={<ReturnsPage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="imports" element={<ImportsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="audit" element={<AuditLogPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
