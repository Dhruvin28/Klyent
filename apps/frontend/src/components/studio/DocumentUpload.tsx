import { useRef, useState } from 'react'
import { FileText, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { useStudioDocuments, useUploadStudioDocument } from '@/hooks/useStudio'
import { useToast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'

export function DocumentUpload({ projectId }: { projectId: string }) {
  const { data: documents, isLoading } = useStudioDocuments(projectId)
  const upload = useUploadStudioDocument()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFile = async (file: File) => {
    try {
      await upload.mutateAsync({ file, projectId })
      toast({ title: 'Document uploaded — classifying and indexing...' })
    } catch {
      toast({ title: 'Upload failed', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          const file = e.dataTransfer.files?.[0]
          if (file) handleFile(file)
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          isDragging ? 'border-primary bg-primary/5' : 'border-border'
        }`}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Drag a PDF, DOCX, XLSX, image, or TXT here, or</p>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? 'Uploading...' : 'Browse file'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
            e.target.value = ''
          }}
        />
      </div>

      {isLoading ? (
        <LoadingSpinner className="py-8" />
      ) : !documents || documents.length === 0 ? (
        <EmptyState icon={FileText} title="No documents yet" description="Quotations, BOQs, drawings and catalogues you upload will appear here, auto-classified and searchable." />
      ) : (
        <div className="space-y-2">
          {documents.map((d) => (
            <a
              key={d.id}
              href={d.storageUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-lg border p-3 text-sm hover:bg-muted/50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{d.fileName}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {d.documentType && <Badge variant="secondary">{d.documentType}</Badge>}
                <span className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
