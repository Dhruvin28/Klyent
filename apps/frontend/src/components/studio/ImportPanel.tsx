import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { useImportWhatsAppExport, useStudioIngestionKeyStatus, useGenerateStudioIngestionKey } from '@/hooks/useStudio'
import { useToast } from '@/components/ui/toast'
import type { StudioImportResult } from '@/types'

export function ImportPanel({ projectId }: { projectId: string }) {
  const [groupName, setGroupName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<StudioImportResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const importExport = useImportWhatsAppExport()
  const { toast } = useToast()

  const { data: keyStatus } = useStudioIngestionKeyStatus()
  const generateKey = useGenerateStudioIngestionKey()
  const [newKey, setNewKey] = useState<string | null>(null)

  const handleImport = async () => {
    if (!file || !groupName.trim()) {
      toast({ title: 'Group name and a .txt/.zip export are required', variant: 'destructive' })
      return
    }
    try {
      const res = await importExport.mutateAsync({ file, groupName: groupName.trim(), projectId })
      setResult(res)
      toast({ title: `Imported ${res.messagesIngested} messages` })
    } catch {
      toast({ title: 'Import failed', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <h3 className="font-semibold">Option C — Import a WhatsApp chat export</h3>
            <p className="text-sm text-muted-foreground mt-1">
              In WhatsApp: open the chat → ⋮ More → Export chat (with or without media) → share the resulting
              .zip or .txt file here. Zero integration risk, fully manual — good for validating against real
              historical data before setting up live capture.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="groupName">WhatsApp group name</Label>
            <Input
              id="groupName"
              placeholder="e.g. Patel Residence - Client Group"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Export file (.txt or .zip)</Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" />
                {file ? file.name : 'Choose file'}
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".txt,.zip"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          <Button onClick={handleImport} disabled={importExport.isPending}>
            {importExport.isPending ? 'Importing...' : 'Import'}
          </Button>

          {result && (
            <div className="rounded-lg border p-3 text-sm space-y-1">
              <p>{result.messagesIngested} messages ingested, {result.mediaAttached} media files attached.</p>
              <p className="text-muted-foreground">
                {result.skippedSystemMessages} system messages skipped, {result.errors.length} errors.
              </p>
              {result.errors.length > 0 && (
                <ul className="text-xs text-destructive list-disc pl-4">
                  {result.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div>
            <h3 className="font-semibold">Live capture (Option A/B — future)</h3>
            <p className="text-sm text-muted-foreground mt-1">
              A WhatsApp bridge or the official Cloud API webhook can send messages here in real time by calling{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">POST /api/studio/messages</code> with your
              ingestion key below. Not required for the import above.
            </p>
          </div>
          {newKey ? (
            <div className="rounded-lg border bg-muted/50 p-3 text-xs break-all">
              <p className="font-medium mb-1">Your ingestion key (shown once — copy it now):</p>
              <code>{newKey}</code>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => setNewKey(await generateKey.mutateAsync())}
            >
              {keyStatus?.hasIngestionKey ? 'Regenerate ingestion key' : 'Generate ingestion key'}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
