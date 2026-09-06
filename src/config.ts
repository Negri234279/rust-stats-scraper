import "dotenv/config";

export const config = {
  steamApiKey: process.env.STEAM_API_KEY ?? "",
  port: Number(process.env.PORT ?? 3200),
  headless: (process.env.HEADLESS ?? "true").toLowerCase() !== "false",
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
