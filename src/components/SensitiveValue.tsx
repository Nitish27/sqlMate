import { useState } from 'react';
import { Eye } from 'lucide-react';

interface SensitiveValueProps {
  columnName: string;
  value: unknown;
}

export function SensitiveValue({ columnName, value }: SensitiveValueProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <span className="truncate text-text-secondary">{revealed ? String(value) : 'Hidden'}</span>
      <button
        type="button"
        aria-label={`Hold to reveal ${columnName}`}
        title="Hold to reveal this value"
        className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onPointerDown={(event) => { event.stopPropagation(); setRevealed(true); }}
        onPointerUp={(event) => { event.stopPropagation(); setRevealed(false); }}
        onPointerCancel={() => setRevealed(false)}
        onPointerLeave={() => setRevealed(false)}
        onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') setRevealed(true); }}
        onKeyUp={() => setRevealed(false)}
        onBlur={() => setRevealed(false)}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <Eye size={12} aria-hidden="true" />
      </button>
    </span>
  );
}
