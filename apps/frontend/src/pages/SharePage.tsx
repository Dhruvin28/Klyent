import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileText, ImageIcon, Download, Layers, Calendar, Layers2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { filesApi } from '@/api/files'
import { formatDate, formatFileSize } from '@/lib/utils'
import type { File as KFile } from '@/types'

export function SharePage() {
  const { token } = useParams<{ token: string }>()
  const [file, setFile] = useState<KFile | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!token) return
    filesApi.getSharedFile(token)
      .then((data) => {
        setFile(data.file)
        setPreviewUrl(data.previewUrl)
      })
      .catch(() => setError(true))
      .finally(() => setIsLoading(false))
  }, [token])

  const handleDownload = () => {
    if (!previewUrl) return
    const link = document.createElement('a')
    link.href = previewUrl
    link.download = file?.name ?? 'download'
    link.click()
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
          <p className="text-sm text-muted-foreground">Loading file...</p>
        </div>
      </div>
    )
  }

  if (error || !file) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md px-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mx-auto">
            <FileText className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">File not found</h2>
          <p className="text-sm text-muted-foreground">
            This shared link may have expired or the file may have been removed.
          </p>
        </div>
      </div>
    )
  }

  const isImage = file.mimeType.startsWith('image/')
  const isPdf = file.mimeType === 'application/pdf'

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Layers className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold text-foreground">Klyent</span>
          </div>
          <Button onClick={handleDownload} size="sm" className="gap-2" disabled={!previewUrl}>
            <Download className="h-4 w-4" />
            Download
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* File info */}
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted shrink-0">
              {isImage ? (
                <ImageIcon className="h-6 w-6 text-blue-500" />
              ) : (
                <FileText className="h-6 w-6 text-red-500" />
              )}
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">{file.name}</h1>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <Badge variant="secondary" className="text-xs">
                  {file.mimeType.split('/')[1]?.toUpperCase() ?? file.mimeType}
                </Badge>
                {file.latestVersion && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Layers2 className="h-3 w-3" />
                    v{file.latestVersion.versionNumber}
                  </span>
                )}
                {file.latestVersion && (
                  <span className="text-xs text-muted-foreground">
                    {formatFileSize(file.latestVersion.size)}
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {formatDate(file.createdAt)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Preview */}
        <Card>
          <CardContent className="p-0 overflow-hidden rounded-lg">
            {previewUrl ? (
              isImage ? (
                <div className="flex items-center justify-center bg-muted/30 p-8 min-h-[400px]">
                  <img
                    src={previewUrl}
                    alt={file.name}
                    className="max-w-full max-h-[600px] object-contain rounded shadow"
                  />
                </div>
              ) : isPdf ? (
                <iframe
                  src={previewUrl}
                  className="w-full h-[600px]"
                  title={file.name}
                />
              ) : (
                <div className="flex items-center justify-center bg-muted/30 min-h-[200px] text-muted-foreground text-sm">
                  Preview not available for this file type.
                  <Button variant="link" onClick={handleDownload}>Download</Button>
                </div>
              )
            ) : (
              <div className="flex items-center justify-center bg-muted/30 min-h-[200px] text-muted-foreground text-sm">
                Loading preview...
              </div>
            )}
          </CardContent>
        </Card>

        {/* Shared via */}
        <p className="text-xs text-center text-muted-foreground">
          This file was shared via Klyent — Client Management Software
        </p>
      </main>
    </div>
  )
}
