import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';

export default function AdminNotices() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', audience: 'all' });

  const load = () => api.get('/announcements').then(setItems).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const publish = async (e) => {
    e.preventDefault();
    try {
      await api.post('/announcements', form);
      toast.success('Notice published to members');
      setOpen(false); setForm({ title: '', body: '', audience: 'all' });
      load();
    } catch (err) { toast.error(err.message); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this notice?')) return;
    try {
      await api.del(`/announcements/${id}`);
      toast.success('Deleted');
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Notice Board</CardTitle>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm">New Notice</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Publish Notice</DialogTitle></DialogHeader>
              <form onSubmit={publish} className="space-y-4">
                <div><Label>Title</Label><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. AGM this Saturday" /></div>
                <div><Label>Message</Label><Textarea required rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></div>
                <div>
                  <Label>Audience</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                    <option value="all">Everyone</option>
                    <option value="members">Members only</option>
                    <option value="staff">Staff only</option>
                  </select>
                </div>
                <DialogFooter><Button type="submit">Publish</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((n) => (
            <div key={n.id} className="border rounded-md p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{n.title}</p>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="capitalize">{n.audience}</Badge>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(n.id)}>Delete</Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{n.body}</p>
              <p className="text-xs text-muted-foreground mt-2">
                {n.first_name ? `${n.first_name} ${n.last_name} · ` : ''}{formatDateTime(n.created_at)}
              </p>
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No notices yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
