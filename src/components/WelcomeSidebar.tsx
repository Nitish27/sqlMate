import { Logo } from './Logo';
import { ThemeSettings } from './ThemeSettings';
import { RefreshCw } from 'lucide-react';

interface WelcomeSidebarProps {
  onCheckForUpdates: () => void;
  isCheckingForUpdates: boolean;
}

export const WelcomeSidebar = ({ onCheckForUpdates, isCheckingForUpdates }: WelcomeSidebarProps) => {

  return (
    <div className="w-[280px] bg-sidebar flex flex-col py-12 px-6 border-r border-border select-none">
      <div className="flex-1 flex flex-col items-center justify-center">
        {/* Branding */}
        <div className="flex flex-col items-center gap-2 mb-10 text-center">
          <Logo height={50} />
          <p className="text-[11px] text-text-muted mt-[-2px] font-medium tracking-widest uppercase opacity-60">Native Database Client</p>
        </div>
      </div>

      {/* Social Links */}
      {/* <div className="flex gap-4 text-text-muted mb-10">
        <button className="hover:text-[#1DA1F2] transition-colors"><Twitter size={14} /></button>
        <button className="hover:text-white transition-colors"><Github size={14} /></button>
        <button className="hover:text-[#4267B2] transition-colors"><Facebook size={14} /></button>
      </div> */}

      <button
        onClick={onCheckForUpdates}
        disabled={isCheckingForUpdates}
        className="mb-6 inline-flex items-center justify-center gap-2 text-[11px] font-semibold text-accent transition-colors hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
      >
        <RefreshCw size={13} className={isCheckingForUpdates ? 'animate-spin' : ''} />
        {isCheckingForUpdates ? 'Checking for updates...' : 'Check for updates'}
      </button>

      <div className="w-full border-t border-border pt-5">
        <div className="mb-2 text-[10px] font-bold text-text-muted uppercase tracking-[0.2em]">
          Preferences
        </div>
        <ThemeSettings displayMode="sidebar" align="left" defaultScope="sidebars" />
      </div>
    </div>
  );
};
