
import { Logo } from './Logo';

export const WelcomeSidebar = () => {

  return (
    <div className="w-[280px] bg-[#1e1e1e] flex flex-col items-center justify-center py-12 px-6 border-r border-black/20 select-none">
      {/* Branding */}
      <div className="flex flex-col items-center gap-2 mb-10 text-center">
        <Logo height={50} />
        <p className="text-[11px] text-text-muted mt-[-2px] font-medium tracking-widest uppercase opacity-60">Native Database Client</p>
      </div>

      {/* Social Links */}
      {/* <div className="flex gap-4 text-text-muted mb-10">
        <button className="hover:text-[#1DA1F2] transition-colors"><Twitter size={14} /></button>
        <button className="hover:text-white transition-colors"><Github size={14} /></button>
        <button className="hover:text-[#4267B2] transition-colors"><Facebook size={14} /></button>
      </div> */}

      {/* Update Alert */}
      {/* <div className="mb-auto text-center">
        <span className="text-[11px] font-bold text-accent cursor-pointer hover:underline">
          Check for updates
        </span>
      </div> */}

      {/* Quick Actions */}
      {/* <div className="grid grid-cols-3 gap-6 w-full mt-8 border-t border-black/10 pt-8">
        <div className="flex flex-col items-center gap-2 group cursor-pointer">
          <div className="w-10 h-10 bg-[#2C2C2C] rounded-xl flex items-center justify-center text-text-muted group-hover:bg-[#3C3C3C] group-hover:text-white transition-all shadow-sm">
            <Database size={18} />
          </div>
          <span className="text-[10px] font-medium text-text-muted">Backup</span>
        </div>
        <div className="flex flex-col items-center gap-2 group cursor-pointer">
          <div className="w-10 h-10 bg-[#2C2C2C] rounded-xl flex items-center justify-center text-text-muted group-hover:bg-[#3C3C3C] group-hover:text-white transition-all shadow-sm">
            <Cloud size={18} />
          </div>
          <span className="text-[10px] font-medium text-text-muted">Restore</span>
        </div>
        <div className="flex flex-col items-center gap-2 group cursor-pointer">
          <div className="w-10 h-10 bg-[#2C2C2C] rounded-xl flex items-center justify-center text-text-muted group-hover:bg-[#3C3C3C] group-hover:text-white transition-all shadow-sm">
            <Settings size={18} />
          </div>
          <span className="text-[10px] font-medium text-text-muted">Register</span>
        </div>
      </div> */}
    </div>
  );
};
