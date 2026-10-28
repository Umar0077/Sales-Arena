import {
  Trophy, Gift, Package, Headphones, BadgeCheck, Sparkles, Coffee, Ticket, Star, Crown, Rocket, Medal,
  type LucideIcon,
} from "lucide-react";
import type { RewardIcon } from "@/types";

export const REWARD_ICON_COMPONENTS: Record<RewardIcon, LucideIcon> = {
  trophy: Trophy, gift: Gift, package: Package, headphones: Headphones, badge: BadgeCheck, sparkles: Sparkles,
  coffee: Coffee, ticket: Ticket, star: Star, crown: Crown, rocket: Rocket, medal: Medal,
};

export function RewardIconView({ icon, className, style }: { icon: RewardIcon; className?: string; style?: React.CSSProperties }) {
  const Icon = REWARD_ICON_COMPONENTS[icon] ?? Gift;
  return <Icon className={className} style={style} aria-hidden />;
}
