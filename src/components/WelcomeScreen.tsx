import { WelcomeSidebar } from './WelcomeSidebar';
import { WelcomeConnectionManager } from './WelcomeConnectionManager';

interface WelcomeScreenProps {
  onCheckForUpdates: () => void;
  isCheckingForUpdates: boolean;
}

export const WelcomeScreen = ({ onCheckForUpdates, isCheckingForUpdates }: WelcomeScreenProps) => {
  return (
    <div className="flex-1 flex overflow-hidden animate-in fade-in duration-500">
      <WelcomeSidebar
        onCheckForUpdates={onCheckForUpdates}
        isCheckingForUpdates={isCheckingForUpdates}
      />
      <WelcomeConnectionManager />
    </div>
  );
};
