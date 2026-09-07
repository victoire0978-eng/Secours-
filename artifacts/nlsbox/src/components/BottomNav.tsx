import React from 'react';
import { Home, Download, Settings, HardDriveDownload } from 'lucide-react';

export type NavTab = 'home' | 'downloads' | 'settings' | 'offline';

interface BottomNavProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  activeDownloadsCount: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onTabChange,
  activeDownloadsCount,
}) => {
  return (
    <nav className="nls-bottom-nav fixed bottom-0 left-0 right-0 z-40 bg-[hsl(var(--background)/.94)] backdrop-blur-xl border-t border-[hsl(var(--border)/.85)] py-2 px-3 pb-[calc(.5rem+env(safe-area-inset-bottom))]">
      <div className="max-w-lg mx-auto flex items-center justify-around">
        {/* Accueil */}
        <button
          onClick={() => onTabChange('home')}
          className={`flex flex-col items-center justify-center py-0.5 px-3 rounded-lg transition-all cursor-pointer ${
            currentTab === 'home'
              ? 'text-[hsl(var(--primary))] font-bold'
              : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
          }`}
        >
          <div className="relative">
            <Home className="w-4 h-4" />
            {currentTab === 'home' && (
              <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-[hsl(var(--primary))] rounded-full" />
            )}
          </div>
          <span className="text-[10px] mt-0.5">Accueil</span>
        </button>

        {/* Téléchargements */}
        <button
          onClick={() => onTabChange('downloads')}
          className={`flex flex-col items-center justify-center py-0.5 px-3 rounded-lg transition-all cursor-pointer relative ${
            currentTab === 'downloads'
              ? 'text-[hsl(var(--accent))] font-bold'
              : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
          }`}
        >
          <div className="relative">
            <Download className="w-4 h-4" />
            {activeDownloadsCount > 0 && (
              <span className="absolute -top-1 -right-2 px-1 py-0.2 bg-gradient-to-r from-red-600 to-purple-600 text-[8px] font-extrabold text-white rounded-full animate-pulse border border-black">
                {activeDownloadsCount}
              </span>
            )}
            {currentTab === 'downloads' && (
               <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-[hsl(var(--accent))] rounded-full" />
            )}
          </div>
          <span className="text-[10px] mt-0.5">Téléchargements</span>
        </button>

        {/* Hors-ligne (OPFS) */}
        <button
          onClick={() => onTabChange('offline')}
          className={`flex flex-col items-center justify-center py-0.5 px-3 rounded-lg transition-all cursor-pointer ${
            currentTab === 'offline'
              ? 'text-sky-300 font-bold'
              : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
          }`}
        >
          <div className="relative">
            <HardDriveDownload className="w-4 h-4" />
            {currentTab === 'offline' && (
              <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-sky-500 rounded-full" />
            )}
          </div>
          <span className="text-[10px] mt-0.5">Hors-ligne</span>
        </button>

        {/* Paramètres */}
        <button
          onClick={() => onTabChange('settings')}
          className={`flex flex-col items-center justify-center py-0.5 px-3 rounded-lg transition-all cursor-pointer ${
            currentTab === 'settings'
              ? 'text-violet-300 font-bold'
              : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
          }`}
        >
          <div className="relative">
            <Settings className="w-4 h-4" />
            {currentTab === 'settings' && (
              <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-indigo-500 rounded-full" />
            )}
          </div>
          <span className="text-[10px] mt-0.5">Paramètres</span>
        </button>
      </div>
    </nav>
  );
};
