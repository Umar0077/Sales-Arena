/**
 * Settings that are GLOBAL (one value for every FE Sales Arena display), stored in PostgreSQL
 * (admin_settings "arena.config"). Must match the server schema in lib/server/settings/arena-config.ts
 * (a unit test checks this). Anything not listed is a per-device convenience (diagnostics, TV mode,
 * demo simulation) and stays in this browser only. Performance mode has its own global row.
 */
export const GLOBAL_SETTING_KEYS = [
  "arenaEnabled", "arenaOfflineMessage",
  "arenaModes", "defaultArenaMode", "showModeSelector", "businessTimezone", "weekStartDay", "currencyLabel",
  "liveSyncSeconds", "teamsTabVisible",
  "rewardCategories", "announceCash", "announcePrizes", "announceAutoSpins", "announceManualSpins",
  "celebrationPopups", "intensity", "particles", "celebrationDuration", "saleCelebrationStyle", "announceMilestones",
  "announceTeamTargets", "spinFeatureEnabled", "spinFlowEnabled", "spinPopupTimeoutSec", "achievementHeadline",
  "achievementMessage", "achievementReward", "revealHeadline", "revealMessage", "revealStyle",
  "soundEnabled", "volume", "soundCategories",
  "motion", "accent", "brandName", "brandTagline", "customLogo", "backgroundEffects", "showKpis", "showHero", "showActivity",
  "spinnerTheme", "segmentColorMode", "glowIntensity", "spinnerLights", "lightSpeed", "spinDurationScale", "spinnerFallback2D",
  "leaderboardVisible", "leaderboardCount", "leaderboardCriteria", "leaderboardPeriod", "leaderboardTeamId",
  "leaderboardCampaignId", "leaderboardAnimations", "leaderboardSize", "topPerformerStyle",
  "arenaCub",
] as const;

const SET = new Set<string>(GLOBAL_SETTING_KEYS);
export const isGlobalSetting = (k: string) => SET.has(k);
