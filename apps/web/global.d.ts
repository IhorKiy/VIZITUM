import type messages from "./messages/en.json";
import type { AppLocale } from "./lib/tenant-locale";

declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: typeof messages;
  }
}
