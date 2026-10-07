import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import StatCard from '@/components/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TrendingUp, Clock } from 'lucide-react';

export default function Dividends() {
  const [summary, setSummary] = useState(null);
  const [list, setList] = useState([]);

  useEffect(() => {
    Promise.all([api.get('/dividends/summary'), api.get('/dividends')])
      .then(([s, l]) => { setSummary(s); setList(l); });
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard title="Total Dividends Paid" value={formatCurrency(summary?.total_paid)} icon={TrendingUp} />
        <StatCard title="Pending Dividends" value={formatCurrency(summary?.total_pending)} icon={Clock} />
      </div>

      <Card>
        <CardHeader><CardTitle>Dividend History</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.period}</TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(d.amount)}</TableCell>
                  <TableCell><Badge variant={d.status === 'paid' ? 'success' : 'warning'} className="capitalize">{d.status}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(d.created_at)}</TableCell>
                </TableRow>
              ))}
              {list.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No dividends yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}