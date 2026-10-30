/**
 * Status: SKELETON. This app does not yet call the backend API or render
 * any real screen. It exists so the project builds and runs, and to make
 * the planned screen map (../docs/04-screen-map.md) visible to reviewers.
 * Do not treat anything below as a finished feature.
 */
export default function App() {
  const plannedScreens = [
    "Bulk import/export (products, suppliers, opening stock)",
    "Full reporting suite (lot report, supplier performance, channel sales, ...)",
    "User & role administration",
    "Audit log viewer",
    "Period lock / reopen",
    "Backup status",
    "Opening-data import wizard",
  ];

  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 640 }}>
      <h1>Used Goods ERP — Admin</h1>
      <p>
        <strong>This is an unimplemented skeleton.</strong> See{" "}
        <code>docs/04-screen-map.md</code> and <code>docs/01-implementation-plan.md</code> in the
        repo root for the real plan and current stage.
      </p>
      <h2>Planned admin-only screens</h2>
      <ul>
        {plannedScreens.map((screen) => (
          <li key={screen}>{screen}</li>
        ))}
      </ul>
    </main>
  );
}
