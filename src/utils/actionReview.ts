interface ReviewAction {
  id: string;
  label: string;
  destructive?: boolean;
}

export interface ActionReview {
  title: string;
  description: string;
  details?: string;
  actions: ReviewAction[];
}

type PendingReview = ActionReview & { sequence: number };
let pending: { review: PendingReview; resolve: (choice: string | null) => void } | null = null;
let sequence = 0;
const listeners = new Set<() => void>();

export const getReview = () => pending?.review ?? null;
export function subscribeReview(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function requestReview(review: ActionReview): Promise<string | null> {
  if (pending) return Promise.resolve(null);
  return new Promise(resolve => {
    pending = { review: { ...review, sequence: ++sequence }, resolve };
    listeners.forEach(listener => listener());
  });
}

export function settleReview(review: ActionReview | null, choice: string | null) {
  if (!pending || pending.review !== review || (choice !== null && !review.actions.some(action => action.id === choice))) return;
  const { resolve } = pending;
  pending = null;
  listeners.forEach(listener => listener());
  resolve(choice);
}
