import { useFetch } from "../api/useFetch";

interface AuditEvent {
  id: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  createdAt: string;
}

export function AuditLogPage() {
  const events = useFetch<AuditEvent[]>("/audit-events?limit=200");

  return (
    <div>
      <h1>Audit Log</h1>
      <div className="panel">
        {events.loading && <p>Loading...</p>}
        {events.data && (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {events.data.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.createdAt).toLocaleString()}</td>
                  <td>
                    <span className="badge">{e.action}</span>
                  </td>
                  <td>
                    {e.entityType} · {e.entityId.slice(0, 8)}
                  </td>
                  <td>{e.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
