import { useState } from 'react'
import { FileText, ImageIcon, Eye, Download, Share2, Trash2, Clock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { FilePreview } from './FilePreview'
import { ShareDialog } from './ShareDialog'
import { formatDate, formatFileSize } from '@/lib/utils'
import { filesApi } from '@/api/files'
import { useDeleteFile } from '@/hooks/useFiles'
import { useToast } from '@/components/ui/toast'
import type { File as KFile } from '@/types'

interface FileListProps {
  files: KFile[]
  isLoading: boolean
  clientId?: string
  freelanceProjectId?: string
}

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('image/')) return <ImageIcon className="h-8 w-8 text-blue-500" />
  return <FileText className="h-8 w-8 text-red-500" />
}

export function FileList({ files, isLoading, clientId, freelanceProjectId }: FileListProps) {
  const [previewFile, setPreviewFile] = useState<KFile | null>(null)
  const [shareFile, setShareFile] = useState<KFile | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const deleteFile = useDeleteFile({ clientId, freelanceProjectId })
  const { toast } = useToast()

  const handleDownload = async (file: KFile) => {
    try {
      const url = await filesApi.getFilePreview(file.id)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      link.target = '_blank'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch {
      toast({ title: 'Download failed', description: 'Could not download the file.', variant: 'destructive' })
    }
  }

  const handleDelete = async () => {
    if (!deletingId) return
    try {
      await deleteFile.mutateAsync(deletingId)
      toast({ title: 'File deleted' })
    } catch {
      toast({ title: 'Error', description: 'Failed to delete file.', variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="h-12 w-12 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <Skeleton className="h-8 w-full mt-4" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (!files.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">No files yet</p>
        <p className="text-xs text-muted-foreground mt-1">Upload a PDF or image to get started.</p>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {files.map((file) => (
          <Card key={file.id} className="hover:shadow-md transition-shadow group">
            <CardContent className="p-4">
              {/* File info */}
              <div className="flex items-start gap-3">
                <div className="shrink-0 flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                  <FileIcon mimeType={file.mimeType} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate" title={file.name}>
                    {file.name}
                  </p>
                  {file.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{file.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {file.latestVersion && (
                      <span className="text-xs text-muted-foreground">
                        {formatFileSize(file.latestVersion.size)}
                      </span>
                    )}
                    {file._count && file._count.versions > 0 && (
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">
                        v{file._count.versions}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDate(file.createdAt)}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 mt-3 pt-3 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 flex-1 gap-1.5 text-xs"
                  onClick={() => setPreviewFile(file)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 flex-1 gap-1.5 text-xs"
                  onClick={() => setShareFile(file)}
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleDownload(file)}
                  title="Download"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setDeletingId(file.id)}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <FilePreview
        file={previewFile}
        open={!!previewFile}
        onOpenChange={(open) => { if (!open) setPreviewFile(null) }}
      />

      <ShareDialog
        file={shareFile}
        open={!!shareFile}
        onOpenChange={(open) => { if (!open) setShareFile(null) }}
      />

      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(open) => { if (!open) setDeletingId(null) }}
        title="Delete File"
        description="Are you sure you want to delete this file? All versions and comments will be removed."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        isLoading={deleteFile.isPending}
      />
    </>
  )
}
