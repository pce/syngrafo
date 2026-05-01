import { useState, useEffect } from "react";

export type ThemeName =
  | "light"
  | "dark"
  | "solarized-dark"
  | "monokai"
  | "material-palenight";

interface ThemeConfig {
  name: ThemeName;
  label: string;
  isDark: boolean;
}

export const themes: ThemeConfig[] = [
  { name: "light", label: "Light", isDark: false },
  { name: "dark", label: "Dark", isDark: true },
  { name: "solarized-dark", label: "Solarized Dark", isDark: true },
  { name: "monokai", label: "Monokai Pro", isDark: true },
  { name: "material-palenight", label: "Material Palenight", isDark: true },
];

export const useTheme = () => {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const saved = localStorage.getItem("nlp-studio-theme");
    return (
      (saved as ThemeName) ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light")
    );
  });

  useEffect(() => {
    const root = window.document.documentElement;

    // Remove all previous theme classes
    themes.forEach((t) => root.classList.remove(`theme-${t.name}`));

    // Add new theme class
    root.classList.add(`theme-${theme}`);

    // Handle standard Tailwind dark mode class
    const currentThemeConfig = themes.find((t) => t.name === theme);
    if (currentThemeConfig?.isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    localStorage.setItem("nlp-studio-theme", theme);
  }, [theme]);

  const toggleTheme = (newTheme: ThemeName) => {
    setTheme(newTheme);
  };

  return {
    theme,
    setTheme: toggleTheme,
    availableThemes: themes,
  };
};

export default useTheme;
