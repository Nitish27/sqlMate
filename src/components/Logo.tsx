import appIcon from '../../assets/app-icon.svg';

interface LogoProps {
  className?: string;
  height?: number | string;
}

export function Logo({ className = '', height = 32 }: LogoProps) {
  const size = typeof height === 'number' ? height : parseInt(height, 10) || 32;

  return (
    <div className={`flex select-none items-center gap-2.5 ${className}`}>
      <img src={appIcon} width={size} height={size} alt="" />
      <span className="font-bold leading-none tracking-tight text-text-primary" style={{ fontSize: size * 0.7 }}>
        sql<span className="text-accent">Mate</span>
      </span>
    </div>
  );
}
