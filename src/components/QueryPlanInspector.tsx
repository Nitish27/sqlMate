import { useState } from 'react';
import { ChevronDown, ChevronRight, Database, Info } from 'lucide-react';
import { getQueryPlanNodes, type QueryPlanNode, type QueryPlanResult } from '../utils/queryPlan';

interface QueryPlanInspectorProps {
  result: QueryPlanResult | null;
  isLoading: boolean;
  error: string | null;
}

const PlanStep = ({ node, depth = 0 }: { node: QueryPlanNode; depth?: number }) => {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        className="group flex items-start gap-2 rounded-md px-3 py-2 hover:bg-white/5"
        style={{ marginLeft: depth * 18 }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.title}`}
            aria-expanded={expanded}
            onClick={() => setExpanded(previous => !previous)}
            className="mt-0.5 shrink-0 text-text-muted hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : <span className="w-[14px] shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-primary">
            <span className="font-medium">{node.title}</span>
            {node.badge && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${node.badge === 'scan'
                ? 'bg-amber-500/10 text-amber-300' : 'bg-sky-500/10 text-sky-300'}`}>
                {node.badge === 'scan' ? 'Full scan' : 'Index'}
              </span>
            )}
          </div>
          {node.meta.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
              {node.meta.map((item, index) => <span key={`${node.id}-${index}`}>{item}</span>)}
            </div>
          )}
        </div>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map(child => <PlanStep key={child.id} node={child} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
};

export const QueryPlanInspector = ({ result, isLoading, error }: QueryPlanInspectorProps) => {
  const [showRaw, setShowRaw] = useState(false);
  const nodes = result ? getQueryPlanNodes(result) : [];

  if (isLoading) {
    return <div role="status" className="h-full flex items-center justify-center text-xs text-text-muted">Preparing estimated plan...</div>;
  }
  if (error) {
    return <div role="alert" className="m-4 rounded border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-300 whitespace-pre-wrap">{error}</div>;
  }
  if (!result) {
    return <div className="h-full flex items-center justify-center text-xs text-text-muted">Choose Explain to inspect the current SELECT.</div>;
  }

  return (
    <div className="h-full overflow-auto p-4 text-text-primary">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-accent/10 p-2 text-accent"><Database size={16} /></div>
          <div>
            <div className="text-xs font-semibold">Plan for last explained SELECT</div>
            <div className="text-[11px] text-text-muted">{result.databaseType} | planned in {result.planningTimeMs}ms | query not run</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowRaw(previous => !previous)}
          aria-pressed={showRaw}
          className="rounded border border-border px-3 py-1.5 text-[11px] text-text-secondary hover:bg-white/5 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {showRaw ? 'Show steps' : 'Show raw plan'}
        </button>
      </div>

      {showRaw ? (
        <div>
          <p className="mb-2 text-[11px] text-text-muted">Raw plans may include SQL predicates or literal values.</p>
          <pre className="overflow-auto rounded-lg border border-border bg-[#171717] p-4 font-mono text-[11px] leading-relaxed text-text-secondary select-text">
            {JSON.stringify(result.plan, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-2">
          {nodes.map(node => <PlanStep key={node.id} node={node} />)}
          <div className="mt-2 flex items-center gap-2 border-t border-border px-3 pt-3 text-[11px] text-text-muted">
            <Info size={12} /> Estimates are optimizer predictions. A full scan is not always a problem.
          </div>
        </div>
      )}
    </div>
  );
};
