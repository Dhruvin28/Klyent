import { useState } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/utils'
import { useComments, useAddComment } from '@/hooks/useFiles'
import { useToast } from '@/components/ui/toast'

interface CommentSectionProps {
  fileId: string
}

export function CommentSection({ fileId }: CommentSectionProps) {
  const [newComment, setNewComment] = useState('')
  const { data: comments = [], isLoading } = useComments(fileId)
  const addComment = useAddComment(fileId)
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newComment.trim()) return
    try {
      await addComment.mutateAsync(newComment.trim())
      setNewComment('')
    } catch {
      toast({ title: 'Error', description: 'Failed to add comment.', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-foreground">Comments ({comments.length})</h4>

      {/* Comment input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add a comment..."
          rows={2}
          className="flex-1 resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleSubmit(e)
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!newComment.trim() || addComment.isPending}
          className="self-end"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>

      {/* Comments list */}
      <div className="space-y-3 max-h-64 overflow-y-auto">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          ))
        ) : comments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No comments yet.</p>
        ) : (
          comments.map((comment) => {
            const initials = comment.user.name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .toUpperCase()
              .slice(0, 2)
            return (
              <div key={comment.id} className="flex gap-3">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{comment.user.name}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</span>
                  </div>
                  <p className="text-sm text-foreground/80 mt-0.5">{comment.content}</p>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
