import React from 'react';
import {
  Film,
  Clapperboard,
  Gamepad2,
  Image as ImageIcon,
  Music,
  FileText,
  ShieldAlert,
} from 'lucide-react';
import { HubCategory } from '../types';

interface HubSelectorProps {
  activeCategory: HubCategory;
  onSelectCategory: (category: HubCategory) => void;
  channelsCountMap?: Record<HubCategory, number>;
  isMatureVisible?: boolean;
}

export const HubSelector: React.FC<HubSelectorProps> = ({
  activeCategory,
  onSelectCategory,
  isMatureVisible = false,
}) => {
  const hubs: Array<{
    id: HubCategory;
    title: string;
    icon: React.ElementType;
    gradient: string;
    activeBorder: string;
    activeBg: string;
    activeText: string;
  }> = [
    {
      id: 'anime',
      title: 'Animés',
      icon: Film,
      gradient: 'from-orange-500 to-rose-500',
      activeBorder: 'border-orange-400/80',
      activeBg: 'bg-orange-400/15',
      activeText: 'text-orange-300',
    },
    {
      id: 'movie_series',
      title: 'Films & Séries',
      icon: Clapperboard,
      gradient: 'from-sky-500 to-indigo-500',
      activeBorder: 'border-sky-400/80',
      activeBg: 'bg-sky-400/15',
      activeText: 'text-sky-300',
    },
    {
      id: 'games',
      title: 'Jeux',
      icon: Gamepad2,
      gradient: 'from-amber-400 to-orange-500',
      activeBorder: 'border-amber-400/80',
      activeBg: 'bg-amber-400/15',
      activeText: 'text-amber-300',
    },
    {
      id: 'wallpapers',
      title: 'Wallpapers',
      icon: ImageIcon,
      gradient: 'from-cyan-400 to-sky-500',
      activeBorder: 'border-cyan-400/80',
      activeBg: 'bg-cyan-400/15',
      activeText: 'text-cyan-300',
    },
    {
      id: 'music',
      title: 'Musique',
      icon: Music,
      gradient: 'from-fuchsia-500 to-violet-500',
      activeBorder: 'border-fuchsia-400/80',
      activeBg: 'bg-fuchsia-400/15',
      activeText: 'text-fuchsia-300',
    },
    {
      id: 'document',
      title: 'Mangas',
      icon: FileText,
      gradient: 'from-emerald-400 to-teal-500',
      activeBorder: 'border-emerald-400/80',
      activeBg: 'bg-emerald-400/15',
      activeText: 'text-emerald-300',
    },
    {
      id: 'mature',
      title: 'Espace +18',
      icon: ShieldAlert,
      gradient: 'from-rose-500 to-red-600',
      activeBorder: 'border-rose-400/80',
      activeBg: 'bg-rose-400/15',
      activeText: 'text-rose-300',
    },
  ];

  const visibleHubs = hubs.filter((hub) => hub.id !== 'mature' || isMatureVisible);

  return (
    <div className="nls-hub-selector w-full px-3 sm:px-5 py-2">
      {/* Sleek Compact Horizontal Pill Bar */}
      <div className="max-w-5xl mx-auto flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        {visibleHubs.map((hub) => {
          const isActive = activeCategory === hub.id;
          const Icon = hub.icon;

          return (
            <button
              key={hub.id}
              onClick={() => onSelectCategory(hub.id)}
              className={`relative shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all duration-150 cursor-pointer ${
                isActive
                  ? `${hub.activeBg} ${hub.activeBorder} ${hub.activeText} shadow-sm scale-[1.02]`
                : 'bg-[hsl(var(--card)/.75)] border-[hsl(var(--border)/.7)] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--border))] hover:bg-[hsl(var(--card))]'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{hub.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
