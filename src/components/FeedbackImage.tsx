import { useState } from 'react'
import { copy } from '../copy'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

export default function FeedbackImage({ src }: { src: string }) {
  const text = copy.feedback
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="feedback-image-thumbnail" aria-label={text.enlargeImage} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <img src={src} alt={text.imagePreview} loading="lazy" />
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="feedback-dialog feedback-image-dialog" aria-describedby={undefined} showCloseButton closeLabel={text.close}>
        <DialogTitle className="sr-only">{text.imagePreview}</DialogTitle>
        <img src={src} alt={text.imagePreview} />
      </DialogContent>
    </Dialog>
  </>
}
