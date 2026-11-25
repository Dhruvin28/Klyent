import { useState } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useStudioAsk, useStudioProjects } from '@/hooks/useStudio'
import type { StudioAskResponse } from '@/types'

interface Exchange {
  question: string
  response: StudioAskResponse
}

export function StudioAskPage() {
  const [question, setQuestion] = useState('')
  const [projectName, setProjectName] = useState<string | undefined>(undefined)
  const [history, setHistory] = useState<Exchange[]>([])
  const ask = useStudioAsk()
  const { data: projects } = useStudioProjects()

  const handleAsk = async () => {
    if (!question.trim()) return
    const q = question.trim()
    setQuestion('')
    const response = await ask.mutateAsync({ question: q, projectName })
    setHistory((h) => [...h, { question: q, response }])
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Ask Studio AI
          </h1>
          <p className="text-sm text-muted-foreground">Answers are sourced from your ingested messages and documents.</p>
        </div>
        <Select value={projectName ?? '__all__'} onValueChange={(v) => setProjectName(v === '__all__' ? undefined : v)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All projects</SelectItem>
            {projects?.map((p) => (
              <SelectItem key={p.id} value={p.name}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        {history.map((ex, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-end">
              <div className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm max-w-md">{ex.question}</div>
            </div>
            <Card>
              <CardContent className="pt-4 space-y-3 text-sm">
                <p className="whitespace-pre-wrap">{ex.response.answer}</p>
                {ex.response.sources.length > 0 && (
                  <div className="border-t pt-3 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">Sources</p>
                    {ex.response.sources.map((s, j) => (
                      <div key={j} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{s.label}</span> — {s.excerpt}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ))}
        {ask.isPending && <p className="text-sm text-muted-foreground">Thinking...</p>}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="e.g. What did Patel decide about the marble?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
        />
        <Button onClick={handleAsk} disabled={ask.isPending || !question.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
