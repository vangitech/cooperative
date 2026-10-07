import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Check, MoreHorizontal, X } from 'lucide-react';

const statusVariant = { pending: 'warning', collected: 'default', completed: 'success', rejected: 'destructive', cancelled: 'outline' };
const CATS = ['farm', 'electronics', 'groceries'];

export default function AdminStore() {
  const [requests, setRequests] = useState([]);
  const [products, setProducts] = useState([]);
  const [review, setReview] = useState(null);
  const [note, setNote] = useState('');
  const [pOpen, setPOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [pForm, setPForm] = useState({
    name: '', category: 'groceries', description: '', price: '',
    stock: '10', minDownPct: '20', maxMonths: '6', markupPct: '5',
  });

  const load = async () => {
    try {
      const [r, p] = await Promise.all([api.get('/store/requests'), api.get('/store/admin-products')]);
      setRequests(r); setProducts(p);
    } catch (e) { toast.error(e.message); }
  };
  useEffect(() => { load(); }, []);

  const submitReview = async (approved) => {
    if (!review) return;
    try {
      await api.patch(`/store/requests/${review.id}`, { status: approved ? 'approved' : 'rejected', note: note || undefined });
      toast.success(approved ? 'Released for collection' : 'Request rejected');
      setReview(null); setNote(''); load();
    } catch (e) { toast.error(e.message); }
  };

  const openCreate = () => {
    setEdit(null);
    setPForm({ name: '', category: 'groceries', description: '', price: '', stock: '10', minDownPct: '20', maxMonths: '6', markupPct: '5' });
    setPOpen(true);
  };
  const openEdit = (p) => {
    setEdit(p);
    setPForm({
      name: p.name, category: p.category, description: p.description || '', price: p.price,
      stock: p.stock, minDownPct: p.min_down_pct, maxMonths: p.max_months, markupPct: p.markup_pct,
    });
    setPOpen(true);
  };

  const submitProduct = async (e) => {
    e.preventDefault();
    const body = {
      name: pForm.name, category: pForm.category, description: pForm.description || undefined,
      price: Number(pForm.price), stock: Number(pForm.stock),
      minDownPct: Number(pForm.minDownPct), maxMonths: Number(pForm.maxMonths), markupPct: Number(pForm.markupPct),
    };
    try {
      if (edit) await api.patch(`/store/admin-products/${edit.id}`, body);
      else await api.post('/store/admin-products', body);
      toast.success(edit ? 'Product updated' : 'Product created');
      setPOpen(false); load();
    } catch (e) { toast.error(e.message); }
  };

  const toggleArchive = async (p) => {
    try {
      await api.patch(`/store/admin-products/${p.id}`, { status: p.status === 'active' ? 'archived' : 'active' });
      load();
    } catch (e) { toast.error(e.message); }
  };

  const pending = requests.filter((r) => r.status === 'pending');
  const up = (k) => (e) => setPForm({ ...pForm, [k]: e.target.value });

  return (
    <div className="space-y-6">
      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">
            Requests {pending.length > 0 && <Badge variant="warning" className="ml-2">{pending.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
        </TabsList>

        <TabsContent value="requests">
          <Card><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Down</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <p className="font-medium text-sm">{r.first_name} {r.last_name}</p>
                      <p className="text-xs text-muted-foreground">{r.email}</p>
                    </TableCell>
                    <TableCell className="text-sm">{r.product_name} ×{r.quantity} · {r.duration_months} mo</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(r.total_repayable)}</TableCell>
                    <TableCell className="text-right hidden md:table-cell">{formatCurrency(r.down_payment)}</TableCell>
                    <TableCell><Badge variant={statusVariant[r.status]} className="capitalize">{r.status}</Badge></TableCell>
                    <TableCell>
                      {r.status === 'pending' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Review</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => { setReview(r); setNote(''); }}>
                              <Check className="h-4 w-4 text-green-600" /> Approve & Release
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive focus:text-destructive"
                                              onClick={() => { setReview(r); setNote(''); }}>
                              <X className="h-4 w-4" /> Reject…
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {requests.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No requests</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="catalog">
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between p-4 border-b">
                <p className="text-sm text-muted-foreground">{products.length} products</p>
                <Button size="sm" onClick={openCreate}>New Product</Button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right hidden md:table-cell">Stock</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <p className="font-medium text-sm">{p.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{p.category} · {p.markup_pct}% markup · max {p.max_months} mo</p>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(p.price)}</TableCell>
                        <TableCell className="text-right hidden md:table-cell">{p.stock}</TableCell>
                        <TableCell><Badge variant={p.status === 'active' ? 'success' : 'outline'} className="capitalize">{p.status}</Badge></TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(p)}>Edit</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => toggleArchive(p)}>
                                {p.status === 'active' ? 'Archive' : 'Activate'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!review} onOpenChange={(v) => { if (!v) setReview(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Review Collection #{review?.id}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {review?.product_name} ×{review?.quantity} for {review?.first_name} {review?.last_name}.
            Approving deducts {review && formatCurrency(review.down_payment)} down payment from their wallet.
          </p>
          <div><Label>Note (optional)</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <DialogFooter className="gap-2">
            <Button variant="destructive" onClick={() => submitReview(false)}>Reject</Button>
            <Button onClick={() => submitReview(true)}>Approve & Release</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pOpen} onOpenChange={setPOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{edit ? 'Edit Product' : 'New Product'}</DialogTitle></DialogHeader>
          <form onSubmit={submitProduct} className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Name</Label><Input required value={pForm.name} onChange={up('name')} /></div>
            <div>
              <Label>Category</Label>
              <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={pForm.category} onChange={up('category')}>
                {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><Label>Price (₦)</Label><Input type="number" required value={pForm.price} onChange={up('price')} /></div>
            <div className="col-span-2"><Label>Description</Label><Textarea rows={2} value={pForm.description} onChange={up('description')} /></div>
            <div><Label>Stock</Label><Input type="number" value={pForm.stock} onChange={up('stock')} /></div>
            <div><Label>Min down %</Label><Input type="number" step="0.1" value={pForm.minDownPct} onChange={up('minDownPct')} /></div>
            <div><Label>Max months</Label><Input type="number" value={pForm.maxMonths} onChange={up('maxMonths')} /></div>
            <div><Label>Markup % p.a.</Label><Input type="number" step="0.1" value={pForm.markupPct} onChange={up('markupPct')} /></div>
            <div className="col-span-2"><DialogFooter><Button type="submit">{edit ? 'Save Changes' : 'Create Product'}</Button></DialogFooter></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
