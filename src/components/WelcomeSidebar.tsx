import { Twitter, Github, Facebook, Database, Cloud, Settings } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';

export const WelcomeSidebar = () => {
  const logoPath = convertFileSrc("/Users/nitish/.gemini/antigravity/brain/e56c867c-ba4c-4ea0-a1b4-44c4f28c8754/oxide_db_logo_1768762959166.png");

  return (
    <div className="w-[280px] bg-[#1e1e1e] flex flex-col items-center py-12 px-6 border-r border-black/20 select-none">
      {/* Branding */}
      <div className="flex flex-col items-center gap-6 mb-8 text-center">
        <div className="w-32 h-32 relative">
          <img 
            src={logoPath} 
            alt="Oxide DB Logo" 
            className="w-full h-full object-contain filter drop-shadow-[0_0_20px_rgba(227,100,20,0.3)] animate-pulse-slow"
          />
        </div>
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-[#e36414] to-[#fb8b24] bg-clip-text text-transparent tracking-tight">Oxide DB</h1>
          <p className="text-[11px] text-text-muted mt-1 font-medium tracking-wide uppercase opacity-70">A native database client</p>
        </div>
      </div>

      {/* Social Links */}
      <div className="flex gap-4 text-text-muted mb-10">
        <button className="hover:text-[#1DA1F2] transition-colors"><Twitter size={14} /></button>
        <button className="hover:text-white transition-colors"><Github size={14} /></button>
        <button className="hover:text-[#4267B2] transition-colors"><Facebook size={14} /></button>
      </div>

      {/* Update Alert */}
      <div className="mb-auto text-center">
        <span className="text-[11px] font-bold text-accent cursor-pointer hover:underline">
          Check for updates
        </span>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-6 w-full mt-8 border-t border-black/10 pt-8">
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
      </div>
    </div>
  );
};
