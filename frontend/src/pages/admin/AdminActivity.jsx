import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ENTITIES = ['', 'user', 'kyc', 'guarantor', 'loan', 'dividend', 'payment_intent'];

export default function AdminActivity() {
  const [logs, setLogs] = useState([]);
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');

  const load = async () => {
    try {
      const q = new URLSearchParams({ limit: '100' });
      if (action) q.set('action', action);
      if (entity) q.set('entity', entity);
      setLogs(await api.get(`/admin/audit-logs?${q}`));
    } catch (e) {
      toast.error(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Activity Log</CardTitle>
          <CardDescription>Who did what, and when — admin actions, money events, security events</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => { e.preventDefault(); load(); }}
          >
            <div>
              <Label>Action contains</Label>
              <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. loan.approved" />
            </div>
            <div>
              <Label>Entity</Label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={entity} onChange={(e) => setEntity(e.target.value)}
              >
                {ENTITIES.map((en) => (
                  <option key={en} value={en}>{en || 'All'}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium">
              Filter
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDateTime(l.created_at)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {l.email || (l.actor_id ? `user #${l.actor_id}` : <span className="text-muted-foreground">system</span>)}
                  </TableCell>
                  <TableCell><Badge variant="outline" className="font-mono text-xs">{l.action}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {l.entity ? `${l.entity}${l.entity_id ? ` #${l.entity_id}` : ''}` : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono max-w-xs truncate">
                    {l.metadata ? JSON.stringify(typeof l.metadata === 'string' ? JSON.parse(l.metadata) : l.metadata) : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {logs.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No activity yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
