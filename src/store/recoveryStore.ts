import { create } from 'zustand';

export interface RowDraftSummary {
  context: string;
  change_count: number;
}

interface RecoveryState {
  status: 'loading' | 'ready' | 'unavailable';
  error: string | null;
  draftError: string | null;
  drafts: RowDraftSummary[];
  setStatus: (status: RecoveryState['status'], error?: string | null) => void;
  setDrafts: (drafts: RowDraftSummary[]) => void;
  setDraftError: (error: string) => void;
  setDraftCount: (context: string, changeCount: number) => void;
}

export const useRecoveryStore = create<RecoveryState>((set) => ({
  status: 'loading',
  error: null,
  draftError: null,
  drafts: [],
  setStatus: (status, error = null) => set({ status, error }),
  setDrafts: (drafts) => set({ drafts }),
  setDraftError: (draftError) => set({ draftError }),
  setDraftCount: (context, changeCount) => set(state => ({
    drafts: changeCount > 0
      ? [...state.drafts.filter(draft => draft.context !== context), { context, change_count: changeCount }]
      : state.drafts.filter(draft => draft.context !== context),
  })),
}));
