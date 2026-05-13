import { useState } from 'react'
import { Copy, Check, ExternalLink, Link2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import type { File as KFile } from '@/types'

interface ShareDialogProps {
  file: KFile | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShareDialog({ file, open, onOpenChange }: ShareDialogProps) {
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  if (!file) return null

  const shareUrl = file.shareToken
    ? `${window.location.origin}/share/${file.shareToken}`
    : null

  const handleCopy = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast({ title: 'Copied!', description: 'Share link copied to clipboard.' })
    } catch {
      toast({ title: 'Copy failed', description: 'Please copy the link manually.', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Share File
          </DialogTitle>
          <DialogDescription>
            Anyone with this link can view and download <span className="font-medium text-foreground">{file.name}</span>.
            No login required.
          </DialogDescription>
        </DialogHeader>

        {shareUrl ? (
          <div className="space-y-4 pt-2">
            <div className="flex gap-2">
              <Input
                readOnly
                value={shareUrl}
                className="text-sm font-mono bg-muted"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button
                size="icon"
                variant="outline"
                onClick={handleCopy}
                className="shrink-0"
                title="Copy link"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" onClick={handleCopy}>
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Link
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => window.open(shareUrl, '_blank')}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Open Link
              </Button>
            </div>
          </div>
        ) : (
          <div className="py-4 text-center text-sm text-muted-foreground">
            This file does not have a share link available.
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
