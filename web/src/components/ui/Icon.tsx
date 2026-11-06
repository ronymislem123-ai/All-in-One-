import {
  Accessibility, AppWindow, Archive, Baby, Bot, Boxes, Briefcase, Building2, Car, ChartCandlestick, ChartNetwork, Clapperboard, CodeXml, Cpu, Database,
  FileText, FlaskConical, FolderKanban, Gamepad2, GitBranch, Globe, GraduationCap, HeartPulse, HouseWifi, Image, Landmark, Layers, Leaf, Lightbulb,
  Mail, Megaphone, Monitor, Music, Orbit, Palette, Plane, Puzzle, Rocket, Scale, Shield, ShoppingBag, Sparkles, Sun, Tag, Target, Terminal, Workflow,
  Zap, Compass, Atom, Brain, Wrench, BookOpen, type LucideIcon,
} from 'lucide-react';

/** Curated icon set (tree-shaken) for categories, projects and apps. Names are stored as data. */
export const ICONS: Record<string, LucideIcon> = {
  accessibility: Accessibility, 'app-window': AppWindow, archive: Archive, baby: Baby, bot: Bot, boxes: Boxes, briefcase: Briefcase, 'building-2': Building2,
  car: Car, 'candlestick-chart': ChartCandlestick, 'chart-network': ChartNetwork, clapperboard: Clapperboard, code: CodeXml, cpu: Cpu, database: Database,
  'file-text': FileText, 'flask-conical': FlaskConical, 'folder-kanban': FolderKanban, 'gamepad-2': Gamepad2, 'git-branch': GitBranch, globe: Globe,
  'graduation-cap': GraduationCap, 'heart-pulse': HeartPulse, 'house-wifi': HouseWifi, image: Image, landmark: Landmark, layers: Layers, leaf: Leaf,
  lightbulb: Lightbulb, mail: Mail, megaphone: Megaphone, monitor: Monitor, music: Music, orbit: Orbit, palette: Palette, plane: Plane, puzzle: Puzzle,
  rocket: Rocket, scale: Scale, shield: Shield, 'shopping-bag': ShoppingBag, sparkles: Sparkles, sun: Sun, tag: Tag, target: Target, terminal: Terminal,
  workflow: Workflow, zap: Zap, compass: Compass, atom: Atom, brain: Brain, wrench: Wrench, 'book-open': BookOpen,
};
export const ICON_NAMES = Object.keys(ICONS);

export function Icon({ name, fallback = 'orbit', ...props }: { name?: string | null; fallback?: string; size?: number; className?: string; 'aria-hidden'?: boolean }) {
  const C = (name && ICONS[name]) || ICONS[fallback] || Orbit;
  return <C aria-hidden {...props} />;
}

/** Deterministic colour for entities without an explicit colour. */
const PALETTE = ['#8d95ff', '#4fd4c8', '#f2b84b', '#f07aa8', '#6aa7ff', '#5cc98f', '#c792ea', '#ff9d5c', '#55c2b8', '#e57399'];
export function colorFor(seed: string, explicit?: string | null): string {
  if (explicit) return explicit;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function TileIcon({ name, color, seed, size = 'md', label }: { name?: string | null; color?: string | null; seed: string; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const c = colorFor(seed, color);
  return (
    <span className={`tile-icon ${size === 'md' ? '' : size}`} style={{ background: `linear-gradient(140deg, ${c}, color-mix(in srgb, ${c} 55%, #0b0c12))`, color: c }} aria-label={label} role={label ? 'img' : undefined}>
      <Icon name={name} aria-hidden />
    </span>
  );
}
