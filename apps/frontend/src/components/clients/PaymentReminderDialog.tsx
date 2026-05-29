import { useState, useEffect } from 'react'
import { MessageCircle, Copy, Check } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/store/auth.store'
import { formatCurrency } from '@/lib/utils'
import type { Client } from '@/types'

interface PaymentReminderDialogProps {
  client: Client | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function buildMessage(client: Client, companyName: string | null | undefined): string {
  const pending = Math.max(0, client.totalDealAmount - (client.totalPaid ?? 0))
  const lines: string[] = []
  lines.push(`Dear ${client.name},`)
  lines.push('')
  lines.push(`This is a friendly reminder that a payment of *${formatCurrency(pending)}* is currently pending${client.projectDescription ? ` for "${client.projectDescription}"` : ''}.`)
  lines.push('')
  lines.push(`*Payment Summary:*`)
  lines.push(`• Total Deal Amount: ${formatCurrency(client.totalDealAmount)}`)
  lines.push(`• Amount Paid: ${formatCurrency(client.totalPaid ?? 0)}`)
  lines.push(`• *Pending Amount: ${formatCurrency(pending)}*`)
  lines.push('')
  lines.push(`We kindly request you to clear the pending amount at your earliest convenience.`)
  if (client.email) lines.push(``)
  lines.push(`Thank you for your continued trust and support.`)
  lines.push('')
  lines.push(`Warm regards,`)
  lines.push(companyName ?? 'Our Team')
  return lines.join('\n')
}

export function PaymentReminderDialog({ client, open, onOpenChange }: PaymentReminderDialogProps) {
  const user = useAuthStore((s) => s.user)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (client && open) {
      setMessage(buildMessage(client, user?.companyName))
    }
  }, [client, open, user?.companyName])

  const pending = client ? Math.max(0, client.totalDealAmount - (client.totalPaid ?? 0)) : 0

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleWhatsApp = () => {
    const phone = client?.phone?.replace(/\D/g, '') ?? ''
    const encoded = encodeURIComponent(message)
    const url = phone
      ? `https://wa.me/${phone}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`
    window.open(url, '_blank', 'noopener')
  }

  if (!client) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            Payment Reminder — {client.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">Deal</p>
              <p className="font-semibold text-sm">{formatCurrency(client.totalDealAmount)}</p>
            </div>
            <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-3">
              <p className="text-xs text-muted-foreground">Paid</p>
              <p className="font-semibold text-sm text-green-700 dark:text-green-400">{formatCurrency(client.totalPaid ?? 0)}</p>
            </div>
            <div className="rounded-lg bg-orange-50 dark:bg-orange-900/20 p-3">
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="font-semibold text-sm text-orange-700 dark:text-orange-400">{formatCurrency(pending)}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Message (editable)</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={12}
              className="font-mono text-xs resize-none"
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" className="gap-2 w-full sm:w-auto" onClick={handleCopy}>
            {copied ? <><Check className="h-4 w-4 text-green-600" />Copied!</> : <><Copy className="h-4 w-4" />Copy Message</>}
          </Button>
          <Button className="gap-2 w-full sm:w-auto bg-[#25D366] hover:bg-[#1ebe5d] text-white" onClick={handleWhatsApp}>
            <MessageCircle className="h-4 w-4" />
            Share on WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
