import { useState, useEffect } from 'react'
import { Download, Clock, History } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { CommentSection } from './CommentSection'
import { formatFileSize, formatDate } from '@/lib/utils'
import { filesApi } from '@/api/files'
import { useFileVersions } from '@/hooks/useFiles'
import { useToast } from '@/components/ui/toast'
import type { File as KFile } from '@/types'

interface FilePreviewProps {
  file: KFile | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FilePreview({ file, open, onOpenChange }: FilePreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const { data: versions = [], isLoading: versionsLoading } = useFileVersions(file?.id ?? '')
  const { toast } = useToast()

  useEffect(() => {
    if (file && open) {
      setLoadingPreview(true)
      filesApi.getFilePreview(file.id)
        .then((res) => setPreviewUrl(res.url))
        .catch(() => setPreviewUrl(null))
        .finally(() => setLoadingPreview(false))
    } else {
      setPreviewUrl(null)
    }
  }, [file, open])

  const handleDownload = async () => {
    if (!file) return
    try {
      const { url } = await filesApi.getFileDownloadUrl(file.id)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      link.click()
    } catch {
      toast({ title: 'Download failed', description: 'Could not download the file.', variant: 'destructive' })
    }
  }

  const isImage = file?.mimeType.startsWith('image/')
  const isPdf = file?.mimeType === 'application/pdf'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="truncate">{file?.name}</DialogTitle>
            <Button variant="outline" size="sm" onClick={handleDownload} className="shrink-0 ml-2">
              <Download className="h-4 w-4 mr-1" />
              Download
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto flex-1">
          {/* Preview area */}
          <div className="rounded-lg border bg-muted/30 overflow-hidden min-h-[300px] flex items-center justify-center">
            {loadingPreview ? (
              <Skeleton className="w-full h-[300px]" />
            ) : previewUrl ? (
              isImage ? (
                <img
                  src={previewUrl}
                  alt={file?.name}
                  className="max-w-full max-h-[400px] object-contain"
                />
              ) : isPdf ? (
                <iframe
                  src={previewUrl}
                  className="w-full h-[400px]"
                  title={file?.name}
                />
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  <p>Preview not available for this file type.</p>
                </div>
              )
            ) : (
              <div className="text-center text-muted-foreground py-8">
                <p>Preview not available.</p>
              </div>
            )}
          </div>

          {/* File metadata */}
          {file && (
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Type</p>
                <p className="font-medium">{file.mimeType.split('/')[1]?.toUpperCase() ?? file.mimeType}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Uploaded</p>
                <p className="font-medium">{formatDate(file.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Versions</p>
                <p className="font-medium">{file._count?.versions ?? versions.length}</p>
              </div>
            </div>
          )}

          <Separator />

          {/* Version history */}
          {versions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <History className="h-4 w-4" />
                Version History
              </h4>
              <div className="space-y-2">
                {versionsLoading ? (
                  Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
                ) : (
                  versions.map((version) => (
                    <div key={version.id} className="flex items-center justify-between text-sm rounded-md border p-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={version.isActive ? 'default' : 'secondary'} className="text-xs">
                          v{version.versionNumber}
                        </Badge>
                        {version.isActive && <span className="text-xs text-green-600 dark:text-green-400">Current</span>}
                        <span className="text-muted-foreground">{formatFileSize(version.size)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDate(version.createdAt)}
                        {version.uploadedBy && <span>by {version.uploadedBy.name}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <Separator />

          {/* Comments */}
          {file && <CommentSection fileId={file.id} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
