import { WelcomeSidebar } from './WelcomeSidebar';
import { WelcomeConnectionManager } from './WelcomeConnectionManager';

export const WelcomeScreen = () => {
  return (
    <div className="flex-1 flex overflow-hidden animate-in fade-in duration-500">
      <WelcomeSidebar />
      <WelcomeConnectionManager />
    </div>
  );
};
