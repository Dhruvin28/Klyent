import { useState, useRef } from 'react'
import { Upload, X, FileText, ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useUploadFile } from '@/hooks/useFiles'
import { useToast } from '@/components/ui/toast'

interface FileUploadProps {
  clientId?: string
  freelanceProjectId?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function FileUpload({ clientId, freelanceProjectId, open, onOpenChange }: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [customName, setCustomName] = useState('')
  const [description, setDescription] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadFile = useUploadFile({ clientId, freelanceProjectId })
  const { toast } = useToast()

  const VALID_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'image/webp']

  const selectFile = (file: File) => {
    if (!VALID_TYPES.includes(file.type)) {
      toast({ title: 'Invalid file type', description: 'Only PDF, JPG, and PNG files are accepted.', variant: 'destructive' })
      return
    }
    setSelectedFile(file)
    setCustomName(file.name)
  }

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true) }
  const handleDragLeave = () => setIsDragOver(false)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) selectFile(file)
  }
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) selectFile(file)
    e.target.value = ''
  }

  const clearSelection = () => {
    setSelectedFile(null)
    setCustomName('')
    setDescription('')
  }

  const handleUpload = async () => {
    if (!selectedFile) return
    setIsUploading(true)
    setUploadProgress(0)
    try {
      await uploadFile.mutateAsync({
        file: selectedFile,
        name: customName.trim() || selectedFile.name,
        description: description.trim() || undefined,
        onProgress: (p) => setUploadProgress(p),
      })
      toast({ title: 'File uploaded', description: `${customName || selectedFile.name} uploaded successfully.` })
      clearSelection()
    } catch {
      toast({ title: 'Upload failed', description: `Failed to upload ${selectedFile.name}.`, variant: 'destructive' })
    } finally {
      setIsUploading(false)
      setUploadProgress(0)
    }
  }

  const FileTypeIcon = selectedFile?.type.startsWith('image/')
    ? <ImageIcon className="h-5 w-5 text-blue-500" />
    : <FileText className="h-5 w-5 text-red-500" />

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      {!selectedFile ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'relative border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
            isDragOver
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-muted/50'
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={handleInputChange}
            className="hidden"
          />
          <div className="flex flex-col items-center gap-3 pointer-events-none">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Upload className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Drop a file here or <span className="text-primary">browse</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG up to 50MB</p>
            </div>
          </div>
        </div>
      ) : (
        /* Selected file + metadata form */
        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
          {/* File chip */}
          <div className="flex items-center gap-3 p-3 rounded-md bg-background border">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted shrink-0">
              {FileTypeIcon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024).toFixed(1)} KB</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground"
              onClick={clearSelection}
              disabled={isUploading}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Name field */}
          <div className="space-y-1.5">
            <Label htmlFor="file-name" className="text-sm">Name</Label>
            <Input
              id="file-name"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g. Project Invoice March 2024"
              disabled={isUploading}
            />
          </div>

          {/* Description field */}
          <div className="space-y-1.5">
            <Label htmlFor="file-description" className="text-sm">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="file-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this document about? e.g. Invoice for Q1 development work"
              rows={2}
              disabled={isUploading}
              className="resize-none"
            />
          </div>

          {/* Upload button */}
          <Button
            className="w-full gap-2"
            onClick={handleUpload}
            disabled={isUploading || !customName.trim()}
          >
            {isUploading ? (
              <>Uploading... {uploadProgress}%</>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload File
              </>
            )}
          </Button>

          {/* Progress bar */}
          {isUploading && (
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
