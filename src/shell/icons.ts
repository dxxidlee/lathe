import {
  Search, Globe, LayoutGrid, Pipette, Contrast, Download,
  Image, Type, Bookmark, Grid3X3, Waves, Play, Paintbrush,
  Folder, Scissors, Pen, LayoutPanelLeft,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const TOOL_ICONS: Record<string, LucideIcon> = {
  'subject-audit': Search,
  'brand-audit': Globe,
  'deck': LayoutGrid,
  'palette': Pipette,
  'contrast': Contrast,
  'logo-export': Download,
  'icons': Image,
  'specimen': Type,
  'reference': Bookmark,
  'dither': Grid3X3,
  'gradient': Waves,
  'kinetic-type': Play,
  'recolor': Paintbrush,
  'library': Folder,
  'cutout': Scissors,
  'vectorize': Pen,
  'board': LayoutPanelLeft,
};

export function toolIcon(id: string): LucideIcon | null {
  return TOOL_ICONS[id] ?? null;
}
