import { Database, Eye, TableProperties } from 'lucide-react';
import { useDatabaseStore } from '../../../store/databaseStore';

const ITEMS = [
  { icon: TableProperties, label: 'audit_events', active: true },
  { icon: TableProperties, label: 'customers' },
  { icon: TableProperties, label: 'invoices' },
  { icon: Eye, label: 'customer_overview' },
];

export const SidebarPreview = () => {
  const sidebars = useDatabaseStore((state) => state.appearanceSettings.sidebars);

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-sidebar"
      style={{
        fontFamily: sidebars.fontFamily,
        fontSize: `${sidebars.fontSize}px`,
      }}
    >
      <div className="border-b border-border px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
        Preview
      </div>
      <div className="px-4 py-4">
        <div className="mb-3 flex items-center gap-2 text-text-primary">
          <Database size={16} className="text-accent" />
          <span className="font-semibold">Local Database</span>
        </div>

        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
          Tables
        </div>
        <div className="space-y-1">
          {ITEMS.map(({ icon: Icon, label, active }) => (
            <div
              key={label}
              className={active ? 'rounded-lg bg-accent/10 text-accent' : 'rounded-lg text-text-secondary'}
              style={{
                padding: `${sidebars.itemPadding}px`,
              }}
            >
              <div className="flex items-center gap-2">
                <Icon size={14} className={active ? 'text-accent' : 'text-text-muted'} />
                <span className="truncate font-medium">{label}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
