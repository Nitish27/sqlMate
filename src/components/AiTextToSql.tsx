import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, X, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface AiTextToSqlProps {
  connectionId: string;
  onSqlGenerated: (sql: string) => void;
}

export const AiTextToSql = ({ connectionId, onSqlGenerated }: AiTextToSqlProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Focus input when opened
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!prompt.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const sql = await invoke<string>('text_to_sql', {
        connectionId,
        prompt: prompt.trim()
      });
      
      onSqlGenerated(sql);
      setIsOpen(false);
      setPrompt('');
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Failed to generate SQL');
      console.error('AI generation error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2 py-1 transition-colors text-[11px] rounded ${
          isOpen ? 'bg-[#3C3C3C] text-accent' : 'text-text-muted hover:text-accent hover:bg-[#2C2C2C]'
        }`}
        title="Generate SQL with AI (Cmd+I)"
      >
        <Sparkles size={14} className={isOpen ? "text-accent" : ""} />
        AI
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 bg-[#2C2C2C] border border-[#444] rounded-lg shadow-xl z-[60] w-[350px] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#333] bg-[#252525]">
            <div className="flex items-center gap-1.5 text-xs font-medium text-accent">
              <Sparkles size={12} />
              Text to SQL
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="p-0.5 hover:bg-[#454545] rounded text-[#999] hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <div className="p-3 flex flex-col gap-3">
            <div className="relative">
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. Show top 5 users by order amount..."
                className="w-full bg-[#1e1e1e] border border-[#444] rounded text-sm text-text-primary p-2 min-h-[80px] focus:outline-none focus:border-accent/50 resize-none placeholder:text-text-muted/50"
                disabled={isLoading}
              />
              <div className="absolute bottom-2 right-2 text-[10px] text-text-muted pointer-events-none">
                Press Enter ↵
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-400 bg-red-900/20 p-2 rounded border border-red-900/50">
                {error}
              </div>
            )}

            <div className="flex justify-end mt-1">
              <button
                onClick={handleSubmit}
                disabled={!prompt.trim() || isLoading}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  !prompt.trim() || isLoading
                    ? 'bg-[#3A3A3A] text-text-muted cursor-not-allowed'
                    : 'bg-accent hover:bg-accent/80 text-white shadow-sm'
                }`}
              >
                {isLoading ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Send size={12} />
                    Submit
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
