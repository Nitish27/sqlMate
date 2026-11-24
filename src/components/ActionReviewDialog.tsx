import { useRef, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { getReview, settleReview, subscribeReview } from '../utils/actionReview';

export function ActionReviewDialog() {
  const review = useSyncExternalStore(subscribeReview, getReview);
  const cancelRef = useRef<HTMLButtonElement>(null);
  if (!review) return null;

  return <Dialog.Root key={review.sequence} open onOpenChange={open => { if (!open) settleReview(review, null); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/65" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[201] flex max-h-[85vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-border-strong bg-surface p-5 text-text-primary shadow-2xl"
        onOpenAutoFocus={event => { event.preventDefault(); cancelRef.current?.focus(); }}
        onPointerDownOutside={event => event.preventDefault()}
        onKeyDownCapture={event => {
          if ((event.key === 'Enter' && (event.repeat || event.metaKey || event.ctrlKey)) || (event.key === ' ' && event.repeat)) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}>
        <div>
          <Dialog.Title className="text-base font-semibold">{review.title}</Dialog.Title>
          <Dialog.Description className="mt-2 whitespace-pre-line break-words text-sm text-text-secondary">{review.description}</Dialog.Description>
        </div>
        {review.details !== undefined && <pre tabIndex={0} aria-label="Operation details" className="min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed">{review.details}</pre>}
        <div className="flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={() => settleReview(review, null)} className="rounded-md border border-border-strong px-3 py-2 text-xs font-medium hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Cancel</button>
          {review.actions.map(action => <button key={action.id} type="button" onClick={() => settleReview(review, action.id)}
            className={`rounded-md px-3 py-2 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${action.destructive ? 'bg-red-700 hover:bg-red-800' : 'bg-accent hover:bg-accent-hover'}`}>
            {action.label}
          </button>)}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
