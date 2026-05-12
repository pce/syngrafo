import { defineConfig } from "@lingui/conf";
import { formatter } from "@lingui/format-po";

export default defineConfig({
  locales: ["en", "de", "el", "es", "ja", "ja-Latn", "ja-Hrkt"],
  sourceLocale: "en",
  fallbackLocales: { default: "en" },
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["<rootDir>/src"],
    },
  ],
  format: formatter({ lineNumbers: false }),
  compileNamespace: "ts",  // compile --typescript → export Messages as TypeScript
});
