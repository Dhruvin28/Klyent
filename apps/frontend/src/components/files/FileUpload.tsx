import { useState } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUploadFile } from '@/hooks/useFiles'
import { useToast } from '@/components/ui/toast'

interface FileUploadProps {
  clientId: string
}

export function FileUpload({ clientId }: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [isUploading, setIsUploading] = useState(false)
  const uploadFile = useUploadFile(clientId)
  const { toast } = useToast()

  const handleFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    const validFiles = fileArray.filter((f) => {
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'image/webp']
      return validTypes.includes(f.type)
    })

    if (validFiles.length === 0) {
      toast({ title: 'Invalid file type', description: 'Only PDF, JPG, and PNG files are accepted.', variant: 'destructive' })
      return
    }

    for (const file of validFiles) {
      setIsUploading(true)
      setUploadProgress(0)
      try {
        await uploadFile.mutateAsync({
          file,
          onProgress: (p) => setUploadProgress(p),
        })
        toast({ title: 'File uploaded', description: `${file.name} uploaded successfully.` })
      } catch {
        toast({ title: 'Upload failed', description: `Failed to upload ${file.name}.`, variant: 'destructive' })
      } finally {
        setIsUploading(false)
        setUploadProgress(0)
      }
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => setIsDragOver(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files)
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative border-2 border-dashed rounded-lg p-8 text-center transition-colors',
          isDragOver
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50 hover:bg-muted/50'
        )}
      >
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          multiple
          onChange={handleInputChange}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          disabled={isUploading}
        />

        <div className="flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Upload className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              Drop files here or <span className="text-primary">browse</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG up to 50MB</p>
          </div>
        </div>
      </div>

      {/* Upload progress */}
      {isUploading && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Uploading...</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
