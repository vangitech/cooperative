import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime, initials } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Filter, Search, Download } from 'lucide-react';

const TYPE_VARIANTS = {
  deposit: 'success',
  savings: 'default',
  withdrawal: 'destructive',
  loan_disbursement: 'secondary',
  loan_repayment: 'warning',
  dividend: 'success',
};

export default function AdminTransactions() {
  const [txs, setTxs] = useState(null);
  const [q, setQ] = useState('');
  const [activeTypes, setActiveTypes] = useState([]);

  useEffect(() => {
    api.get('/admin/transactions').then(setTxs).catch((e) => toast.error(e.message));
  }, []);

  const allTypes = [...new Set((txs || []).map((t) => t.type))];

  const filtered = (txs || []).filter((t) => {
    const matchQ = `${t.first_name} ${t.last_name} ${t.email} ${t.reference} ${t.type}`
      .toLowerCase().includes(q.toLowerCase());
    const matchType = activeTypes.length === 0 || activeTypes.includes(t.type);
    return matchQ && matchType;
  });

  const toggleType = (type) => {
    setActiveTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const exportCsv = () => {
    const header = ['Reference', 'Member', 'Email', 'Type', 'Amount', 'Balance After', 'Date'];
    const rows = filtered.map((t) => [
      t.reference, `${t.first_name} ${t.last_name}`, t.email,
      t.type, t.amount, t.balance_after, new Date(t.created_at).toISOString(),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `mpcs-transactions-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported transactions');
  };

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between space-y-0">
        <div>
          <CardTitle className="text-base">All Transactions</CardTitle>
          <CardDescription>Every wallet movement across the platform</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="relative">
                <Filter className="h-4 w-4" />
                {activeTypes.length > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-primary text-[10px] text-primary-foreground grid place-items-center">
                    {activeTypes.length}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Filter by type</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {allTypes.map((t) => (
                <DropdownMenuCheckboxItem
                  key={t}
                  checked={activeTypes.includes(t)}
                  onCheckedChange={() => toggleType(t)}
                  onSelect={(e) => e.preventDefault()}
                  className="capitalize"
                >
                  {t.replace('_', ' ')}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="icon" onClick={exportCsv}>
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right hidden md:table-cell">Balance</TableHead>
              <TableHead className="hidden lg:table-cell">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!txs ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  No transactions match your filters
                </TableCell>
              </TableRow>
            ) : filtered.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {initials(t.first_name, t.last_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{t.first_name} {t.last_name}</p>
                      <p className="text-xs text-muted-foreground">{t.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={TYPE_VARIANTS[t.type] || 'outline'} className="capitalize">
                    {t.type.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(t.amount)}</TableCell>
                <TableCell className="text-right hidden md:table-cell">{formatCurrency(t.balance_after)}</TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                  {formatDateTime(t.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
            <span>{filtered.length} transaction{filtered.length !== 1 && 's'}</span>
            <span>Showing latest {filtered.length} of {(txs || []).length}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}