import { useState } from 'react'
import { BookOpen, FileSpreadsheet, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SearchInput } from '@/components/common/SearchInput'
import { EmptyState } from '@/components/common/EmptyState'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/ui/toast'
import { procurementApi, apiErrorMessage } from '@/api/procurement'
import { useInvalidateProcurement, useProductCategories, useProducts, useVendors } from '@/hooks/useProcurement'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ProductDialog } from './ProductDialog'
import { ImportProductsDialog } from './ImportProductsDialog'
import type { VendorProduct } from '@/types'

interface Props {
  vendorId: string
  onVendorChange: (vendorId: string) => void
}

export function CatalogTab({ vendorId, onVendorChange }: Props) {
  const { toast } = useToast()
  const invalidate = useInvalidateProcurement()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<VendorProduct | null>(null)
  const [productOpen, setProductOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleting, setDeleting] = useState<VendorProduct | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  const { data: vendors = [] } = useVendors()
  const { data: categories = [] } = useProductCategories()
  const { data: products = [], isLoading } = useProducts({ q: search, vendorId, category, includeInactive: showInactive })

  // Products sharing a name across vendors are listed cheapest first by the
  // API; mark the cheapest so the comparison is visible at a glance.
  const cheapestByName = new Map<string, string>()
  const countByName = new Map<string, number>()
  for (const p of products) {
    const key = p.name.trim().toLowerCase()
    countByName.set(key, (countByName.get(key) ?? 0) + 1)
    if (!cheapestByName.has(key) && p.isActive) cheapestByName.set(key, p.id)
  }

  const handleDelete = async () => {
    if (!deleting) return
    setDeletePending(true)
    try {
      await procurementApi.deleteProduct(deleting.id)
      invalidate()
      toast({ title: 'Product removed' })
    } catch (err) {
      toast({ title: 'Error', description: apiErrorMessage(err, 'Failed to delete the product.'), variant: 'destructive' })
    } finally {
      setDeletePending(false)
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end justify-between gap-3">
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-end">
          <SearchInput value={search} onChange={setSearch} placeholder="Search products, brands, codes…" className="sm:w-72" />
          <Select value={vendorId || 'all'} onValueChange={(v) => onVendorChange(v === 'all' ? '' : v)}>
            <SelectTrigger className="sm:w-48"><SelectValue placeholder="All vendors" /></SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="all">All vendors</SelectItem>
              {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={category || 'all'} onValueChange={(v) => setCategory(v === 'all' ? '' : v)}>
            <SelectTrigger className="sm:w-48"><SelectValue placeholder="All categories" /></SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm h-10 whitespace-nowrap">
            <input type="checkbox" className="h-4 w-4" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show unavailable
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Import Price List
          </Button>
          <Button onClick={() => { setEditing(null); setProductOpen(true) }}>
            <Plus className="h-4 w-4 mr-1" /> Add Product
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : products.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={search || vendorId || category ? 'No products match' : 'Your vendor catalog is empty'}
          description="Add your vendors' products and rates, or import their price lists. Quotes can then be picked straight from here and compared."
          action={{ label: 'Import Price List', onClick: () => setImportOpen(true) }}
        />
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right hidden md:table-cell">GST</TableHead>
                  <TableHead className="hidden lg:table-cell">Delivery</TableHead>
                  <TableHead className="hidden lg:table-cell">Updated</TableHead>
                  <TableHead className="w-[88px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => {
                  const key = p.name.trim().toLowerCase()
                  const isCheapest = (countByName.get(key) ?? 0) > 1 && cheapestByName.get(key) === p.id
                  return (
                    <TableRow key={p.id} className={p.isActive ? '' : 'opacity-50'}>
                      <TableCell>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{p.name}</span>
                          {isCheapest && <Badge className="border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Lowest</Badge>}
                          {!p.isActive && <Badge variant="secondary">Unavailable</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {[p.brand, p.sku, p.category].filter(Boolean).join(' · ')}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">{p.vendorName}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <span className="font-semibold tabular-nums">{formatCurrency(p.price)}</span>
                        <span className="text-xs text-muted-foreground"> /{p.unit}</span>
                      </TableCell>
                      <TableCell className="text-right hidden md:table-cell">{p.gstRate}%</TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {p.leadTimeDays != null ? `${p.leadTimeDays} day${p.leadTimeDays === 1 ? '' : 's'}` : '—'}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground whitespace-nowrap">
                        {formatDate(p.priceUpdatedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="sm" title="Edit" onClick={() => { setEditing(p); setProductOpen(true) }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" title="Delete"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleting(p)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ProductDialog open={productOpen} onOpenChange={setProductOpen} product={editing} defaultVendorId={vendorId || undefined} />
      <ImportProductsDialog open={importOpen} onOpenChange={setImportOpen} defaultVendorId={vendorId || undefined} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete product"
        description={`Remove ${deleting?.name ?? 'this product'} from ${deleting?.vendorName ?? 'the vendor'}'s price list? To keep its history, mark it unavailable instead.`}
        onConfirm={handleDelete}
        isLoading={deletePending}
      />
    </div>
  )
}
