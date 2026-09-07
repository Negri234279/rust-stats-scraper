import "dotenv/config";

export const config = {
  steamApiKey: process.env.STEAM_API_KEY ?? "",
  port: Number(process.env.PORT ?? 3200),
  headless: (process.env.HEADLESS ?? "true").toLowerCase() !== "false",
  // Server/tab/week lists barely ever change, so cache them for a long time.
  filtersCacheTtlHours: Number(process.env.FILTERS_CACHE_TTL_HOURS ?? 48),
  // Which browser to drive. "chrome" uses the system Google Chrome (good on a dev
  // laptop); "chromium" (or empty) uses Playwright's bundled Chromium — required on
  // Linux ARM64 (Raspberry Pi), where no Chrome channel exists.
  browserChannel: process.env.BROWSER_CHANNEL ?? "chrome",
};

export function assertSteamKey(): string {
  if (!config.steamApiKey) {
    throw new Error(
      "STEAM_API_KEY is not set. Copy .env.example to .env and add your key " +
        "(https://steamcommunity.com/dev/apikey)."
    );
  }
  return config.steamApiKey;
}
