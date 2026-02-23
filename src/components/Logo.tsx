import React from 'react';
import { useDatabaseStore } from '../store/databaseStore';

interface LogoProps {
  className?: string;
  height?: number | string;
}

export const Logo: React.FC<LogoProps> = ({ className = '', height = 32 }) => {
  const theme = useDatabaseStore((state) => state.theme);
  
  // Custom brand highlighter color: rgb(0 122 204) -> #007acc
  const highlightColor = '#007acc'; 
  const textColor = theme === 'dark' ? '#ffffff' : '#1e1e1e';

  // Calculate dimensions
  const h = typeof height === 'number' ? height : parseInt(height as string) || 32;
  // Aspect ratio is calibrated for the icon + text layout
  const w = h * 4.2; 

  return (
    <div className={`flex items-center select-none ${className}`}>
      <svg 
        width={w} 
        height={h} 
        viewBox="0 0 160 40" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Modern Flat 3-tier Stack Icon */}
        <rect x="0" y="8" width="32" height="6" rx="2" fill={highlightColor} />
        <rect x="0" y="17" width="32" height="6" rx="2" fill={highlightColor} />
        <rect x="0" y="26" width="32" height="6" rx="2" fill={highlightColor} />
        
        {/* Typography: "sqlMate" */}
        <text 
          x="42" 
          y="30" 
          fontFamily="Outfit, Inter, sans-serif" 
          fontSize="28" 
          fontWeight="800"
          fill={highlightColor}
          style={{ letterSpacing: '-0.03em' }}
        >
          sql
        </text>
        <text 
          x="82" 
          y="30" 
          fontFamily="Outfit, Inter, sans-serif" 
          fontSize="28" 
          fontWeight="500"
          fill={textColor}
          style={{ letterSpacing: '-0.02em' }}
        >
          Mate
        </text>
      </svg>
    </div>
  );
};
