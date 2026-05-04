#!/usr/bin/env bun
import plugin from "bun-plugin-tailwind";
import { existsSync } from "fs";
import { cp, rm } from "fs/promises";
import path from "path";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
🏗️  Bun Build Script

Usage: bun run build.ts [options]

Common Options:
  --outdir <path>          Output directory (default: "dist")
  --minify                 Enable minification (or --minify.whitespace, --minify.syntax, etc)
  --sourcemap <type>      Sourcemap type: none|linked|inline|external
  --target <target>        Build target: browser|bun|node
  --format <format>        Output format: esm|cjs|iife
  --splitting              Enable code splitting
  --packages <type>        Package handling: bundle|external
  --public-path <path>     Public path for assets
  --env <mode>             Environment handling: inline|disable|prefix*
  --conditions <list>      Package.json export conditions (comma separated)
  --external <list>        External packages (comma separated)
  --banner <text>          Add banner text to output
  --footer <text>          Add footer text to output
  --define <obj>           Define global constants (e.g. --define.VERSION=1.0.0)
  --help, -h               Show this help message

Example:
  bun run build.ts --outdir=dist --minify --sourcemap=linked --external=react,react-dom
`);
  process.exit(0);
}

const toCamelCase = (str: string): string =>
  str.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

const parseValue = (value: string): any => {
  if (value === "true") return true;
  if (value === "false") return false;

  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d*\.\d+$/.test(value)) return parseFloat(value);

  if (value.includes(",")) return value.split(",").map((v) => v.trim());

  return value;
};

function parseArgs(): Partial<Bun.BuildConfig> {
  const config: Record<string, unknown> = {};
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) continue;

    if (arg.startsWith("--no-")) {
      const key = toCamelCase(arg.slice(5));
      config[key] = false;
      continue;
    }

    if (
      !arg.includes("=") &&
      (i === args.length - 1 || args[i + 1]?.startsWith("--"))
    ) {
      const key = toCamelCase(arg.slice(2));
      config[key] = true;
      continue;
    }

    let key: string;
    let value: string;

    if (arg.includes("=")) {
      [key, value] = arg.slice(2).split("=", 2) as [string, string];
    } else {
      key = arg.slice(2);
      value = args[++i] ?? "";
    }

    key = toCamelCase(key);

    if (key.includes(".")) {
      const parts = key.split(".");
      if (parts[0] === "define") {
        // Handle --define.key=value by putting it directly into config.define
        if (!config.define || typeof config.define !== "object") {
          config.define = {};
        }
        const defineKey = parts.slice(1).join(".");
        (config.define as Record<string, string>)[defineKey] = value;
      } else {
        // Handle other nested options like --minify.whitespace
        let current: any = config;
        for (let j = 0; j < parts.length - 1; j++) {
          const part = parts[j]!;
          if (
            typeof current[part] !== "object" ||
            current[part] === null ||
            Array.isArray(current[part])
          ) {
            current[part] = {};
          }
          current = current[part];
        }
        const lastKey = parts[parts.length - 1]!;
        current[lastKey] = parseValue(value);
      }
    } else {
      config[key] = parseValue(value);
    }
  }

  return config as Partial<Bun.BuildConfig>;
}

const formatFileSize = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
};

/**
 * Bun plugin: mark font file URL references in CSS as external so the bundler
 * does not try to resolve /fonts/<file> at build time.  The C++ host serves
 * these files from the saucer::embed bundle at runtime; they are copied into
 * dist/fonts/ by the post-build step below.
 */
const externalFontsPlugin = {
  name: "external-fonts",
  setup(build: any) {
    build.onResolve(
      { filter: /\.(ttf|woff2?|eot|otf)$/ },
      (args: any) => ({ path: args.path, external: true }),
    );
  },
};

console.log("\n\u{1F680} Starting build process...\n");

const cliConfig = parseArgs();
const outdir = cliConfig.outdir as string || path.join(process.cwd(), "dist");

if (existsSync(outdir)) {
  console.log(`🗑️ Cleaning previous build at ${outdir}`);
  await rm(outdir, { recursive: true, force: true });
}

const start = performance.now();

const entrypoints = [...new Bun.Glob("**.html").scanSync("src")]
  .map((a) => path.resolve("src", a))
  .filter((dir) => !dir.includes("node_modules") && !dir.includes("index.ts")); // Filter out any accidental ts files if Glob and scanSync are broad
console.log(
  `📄 Found ${entrypoints.length} HTML ${entrypoints.length === 1 ? "file" : "files"} to process\n`,
);

const isProd = cliConfig.minify === true || process.argv.includes("--minify");

const result = await Bun.build({
  entrypoints,
  outdir,
  plugins: [plugin, externalFontsPlugin],
  minify: isProd,
  target: "browser",
  sourcemap: isProd ? "none" : "linked",
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      isProd ? "production" : "development",
    ),
    "import.meta.env.NODE_ENV": JSON.stringify(
      isProd ? "production" : "development",
    ),
  },
  naming: {
    entry: "[name].[ext]",
    chunk: "[name].[ext]",
    asset: "[name].[ext]",
  },
  ...cliConfig,
});

const end = performance.now();

const outputTable = result.outputs.map((output) => ({
  File: path.relative(process.cwd(), output.path),
  Type: output.kind,
  Size: formatFileSize(output.size),
}));

console.table(outputTable);
const buildTime = (end - start).toFixed(2);

console.log(`\n✅ Build completed in ${buildTime}ms\n`);

// ── Copy bundled fonts into dist/fonts/ ──────────────────────────────────────
// Fonts live in frontend/fonts/ (populated by cmake/frontend.cmake at
// configure time, or by:  python3 scripts/download_fonts.py download).
// Copy them into dist/ so saucer_embed() picks them up alongside JS/CSS.
const fontsSource = path.join(process.cwd(), "..", "..", "fonts");
const fontsDest   = path.join(outdir, "fonts");
if (existsSync(fontsSource)) {
  await cp(fontsSource, fontsDest, { recursive: true, force: true });
  const count = (await Array.fromAsync(
    new Bun.Glob("*.{ttf,woff,woff2,otf,eot}").scan(fontsDest)
  )).length;
  console.log(`\n📦  Copied ${count} font file(s) \u2192 ${path.relative(process.cwd(), fontsDest)}/\n`);
} else {
  // cmake/frontend.cmake normally handles the download before reaching here.
  // If running bun directly outside cmake, fonts may be missing at runtime.
  console.warn(
    `\n⚠️  frontend/fonts/ not found — fonts will be absent at runtime.` +
    `\n   Fix: python3 scripts/download_fonts.py download\n`,
  );
}
