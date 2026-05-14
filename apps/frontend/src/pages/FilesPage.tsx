import { useState } from 'react'
import { FolderOpen, Upload } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/common/EmptyState'
import { FileUpload } from '@/components/files/FileUpload'
import { FileList } from '@/components/files/FileList'
import { useFiles } from '@/hooks/useFiles'
import { useClients } from '@/hooks/useClients'

export function FilesPage() {
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const { data: clientsData } = useClients({ limit: 100 })
  const { data: files = [], isLoading: filesLoading } = useFiles(selectedClientId)

  const clients = clientsData?.data ?? []
  const selectedClient = clients.find((c) => c.id === selectedClientId)

  return (
    <div className="space-y-6">
      {/* Header + client selector */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Files</h2>
          <p className="text-sm text-muted-foreground">Upload and manage documents per client</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Client</p>
          <Select
            value={selectedClientId || 'none'}
            onValueChange={(v) => setSelectedClientId(v === 'none' ? '' : v)}
          >
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="Select a client" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Select a client</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!selectedClientId ? (
        <EmptyState
          icon={FolderOpen}
          title="Select a client"
          description="Choose a client from the dropdown above to view and upload their files."
        />
      ) : (
        <div className="space-y-6">
          {/* Upload section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Upload Files
                {selectedClient && (
                  <span className="font-normal text-muted-foreground">— {selectedClient.name}</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FileUpload clientId={selectedClientId} />
            </CardContent>
          </Card>

          <Separator />

          {/* Files list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">
                Uploaded Files
                {files.length > 0 && (
                  <span className="ml-2 text-muted-foreground font-normal">({files.length})</span>
                )}
              </h3>
            </div>
            <FileList
              files={files}
              isLoading={filesLoading}
              clientId={selectedClientId}
            />
          </div>
        </div>
      )}
    </div>
  )
}
