import { useState } from 'react'
import { Building2, Pencil, Trash2, Phone, MessageCircle, BookOpen, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SearchInput } from '@/components/common/SearchInput'
import { EmptyState } from '@/components/common/EmptyState'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/ui/toast'
import { procurementApi, apiErrorMessage } from '@/api/procurement'
import { useInvalidateProcurement, useVendors } from '@/hooks/useProcurement'
import { formatCurrency } from '@/lib/utils'
import { VendorDialog } from './VendorDialog'
import type { Vendor } from '@/types'

export function VendorsTab({ onShowCatalog }: { onShowCatalog: (vendorId: string) => void }) {
  const { toast } = useToast()
  const invalidate = useInvalidateProcurement()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Vendor | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState<Vendor | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const { data: vendors = [], isLoading } = useVendors(search)

  const handleDelete = async () => {
    if (!deleting) return
    setDeletePending(true)
    try {
      await procurementApi.deleteVendor(deleting.id)
      invalidate()
      toast({ title: 'Vendor deleted' })
    } catch (err) {
      toast({ title: 'Cannot delete', description: apiErrorMessage(err, 'Failed to delete the vendor.'), variant: 'destructive' })
    } finally {
      setDeletePending(false)
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search vendors…" className="sm:w-72" />
        <Button onClick={() => { setEditing(null); setDialogOpen(true) }}>
          <Plus className="h-4 w-4 mr-1" /> Add Vendor
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : vendors.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={search ? 'No vendors match' : 'No vendors yet'}
          description="Add the dealers and suppliers you buy from. Vendors mentioned in imported WhatsApp chats appear here automatically."
          action={search ? undefined : { label: 'Add Vendor', onClick: () => { setEditing(null); setDialogOpen(true) } }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vendors.map((v) => {
            const phone = v.phone?.replace(/\D/g, '')
            return (
              <Card key={v.id} className="flex flex-col">
                <CardContent className="p-4 flex-1 flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{v.name}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {v.category && <Badge variant="secondary">{v.category}</Badge>}
                        {v.gstin && <Badge variant="outline" className="font-mono text-[10px]">{v.gstin}</Badge>}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-muted/60 py-1.5">
                      <p className="text-sm font-semibold">{v.productCount}</p>
                      <p className="text-[11px] text-muted-foreground">Products</p>
                    </div>
                    <div className="rounded-md bg-muted/60 py-1.5">
                      <p className="text-sm font-semibold">{v.quoteCount}</p>
                      <p className="text-[11px] text-muted-foreground">Quotes</p>
                    </div>
                    <div className="rounded-md bg-muted/60 py-1.5">
                      <p className="text-sm font-semibold">{v.orderCount}</p>
                      <p className="text-[11px] text-muted-foreground">Orders</p>
                    </div>
                  </div>

                  {v.orderCount > 0 && (
                    <div className="text-xs space-y-0.5">
                      <div className="flex justify-between"><span className="text-muted-foreground">Ordered</span><span className="tabular-nums">{formatCurrency(v.totalOrdered)}</span></div>
                      {v.balanceDue > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Payable</span><span className="tabular-nums text-amber-600 dark:text-amber-400">{formatCurrency(v.balanceDue)}</span></div>
                      )}
                    </div>
                  )}

                  <div className="mt-auto flex items-center gap-1 border-t border-border pt-3">
                    <Button variant="ghost" size="sm" title="Price list" onClick={() => onShowCatalog(v.id)}>
                      <BookOpen className="h-4 w-4" />
                    </Button>
                    {phone && (
                      <>
                        <Button variant="ghost" size="sm" title="Call" asChild>
                          <a href={`tel:${phone}`}><Phone className="h-4 w-4" /></a>
                        </Button>
                        <Button variant="ghost" size="sm" title="WhatsApp" asChild>
                          <a href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" /></a>
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="sm" title="Edit" onClick={() => { setEditing(v); setDialogOpen(true) }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <div className="flex-1" />
                    <Button
                      variant="ghost" size="sm" title="Delete"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleting(v)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <VendorDialog open={dialogOpen} onOpenChange={setDialogOpen} vendor={editing} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete vendor"
        description={`Delete ${deleting?.name ?? 'this vendor'} and their price list? Quotes you entered for them are removed; quotes from conversations are kept.`}
        onConfirm={handleDelete}
        isLoading={deletePending}
      />
    </div>
  )
}
