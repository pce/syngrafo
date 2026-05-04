import { signal } from "@preact/signals-core";

export interface CSSProperties {
  fontSize?: string;
  fontWeight?: string;
  fontStyle?: string;
  color?: string;
  backgroundColor?: string;
  textAlign?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textDecoration?: string;
  fontFamily?: string;
  padding?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  margin?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  borderBottom?: string;
  borderRadius?: string;
  opacity?: string;
  [key: string]: string | undefined;
}

export class StyleClass {
  private readonly id: string;
  private nameValue: string;
  private readonly baseTag: string;
  private properties: CSSProperties;
  private readonly builtIn: boolean;

  constructor(id: string, name: string, baseTag: string, properties: CSSProperties = {}, builtIn = false) {
    this.id = id;
    this.nameValue = name;
    this.baseTag = baseTag;
    this.properties = { ...properties };
    this.builtIn = builtIn;
  }

  getId(): string {
    return this.id;
  }
  getName(): string {
    return this.nameValue;
  }
  getBaseTag(): string {
    return this.baseTag;
  }
  getProperties(): CSSProperties {
    return { ...this.properties };
  }
  isBuiltIn(): boolean {
    return this.builtIn;
  }

  setName(name: string): void {
    if (this.builtIn) {
      console.warn(`[StyleClass] Cannot rename built-in style "${this.id}"`);
      return;
    }
    this.nameValue = name;
  }

  setProperties(props: CSSProperties): void {
    this.properties = { ...props };
  }

  updateProperty(key: string, value: string | undefined): void {
    if (value === undefined || value === "") {
      const { [key]: _removed, ...rest } = this.properties;
      this.properties = rest;
    } else {
      this.properties = { ...this.properties, [key]: value };
    }
  }

  clone(newId: string, newName: string): StyleClass {
    return new StyleClass(newId, newName, this.baseTag, { ...this.properties }, false);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.nameValue,
      baseTag: this.baseTag,
      properties: this.properties,
      builtIn: this.builtIn,
    };
  }

  static fromJSON(data: { id: string; name: string; baseTag: string; properties?: CSSProperties; builtIn?: boolean }): StyleClass {
    return new StyleClass(data.id, data.name, data.baseTag, data.properties ?? {}, data.builtIn ?? false);
  }
}

export class StyleLibrary {
  private stylesSignal = signal<Map<string, StyleClass>>(new Map());

  constructor(initialStyles?: StyleClass[]) {
    if (initialStyles && initialStyles.length > 0) {
      const map = new Map<string, StyleClass>();
      initialStyles.forEach((s) => map.set(s.getId(), s));
      this.stylesSignal.value = map;
    }
    // No default design system — application layer sets one up.
  }

  getAllStyles(): StyleClass[] {
    return Array.from(this.stylesSignal.value.values());
  }

  getBuiltInStyles(): StyleClass[] {
    return this.getAllStyles().filter((s) => s.isBuiltIn());
  }

  getCustomStyles(): StyleClass[] {
    return this.getAllStyles().filter((s) => !s.isBuiltIn());
  }

  getStyle(id: string): StyleClass | null {
    return this.stylesSignal.value.get(id) ?? null;
  }

  hasStyle(id: string): boolean {
    return this.stylesSignal.value.has(id);
  }

  getStylesSignal() {
    return this.stylesSignal;
  }

  addStyle(style: StyleClass): void {
    const map = new Map(this.stylesSignal.value);
    map.set(style.getId(), style);
    this.stylesSignal.value = map;
  }

  removeStyle(id: string): boolean {
    const style = this.stylesSignal.value.get(id);
    if (!style) return false;
    if (style.isBuiltIn()) {
      console.warn(`[StyleLibrary] Cannot remove built-in style "${id}"`);
      return false;
    }
    const map = new Map(this.stylesSignal.value);
    map.delete(id);
    this.stylesSignal.value = map;
    return true;
  }

  renameStyle(id: string, newName: string): boolean {
    const style = this.stylesSignal.value.get(id);
    if (!style) return false;
    style.setName(newName);
    this.stylesSignal.value = new Map(this.stylesSignal.value);
    return true;
  }

  updateStyleProperty(id: string, key: string, value: string | undefined): boolean {
    const style = this.stylesSignal.value.get(id);
    if (!style) return false;
    style.updateProperty(key, value);
    this.stylesSignal.value = new Map(this.stylesSignal.value);
    return true;
  }

  updateStyleProperties(id: string, props: CSSProperties): boolean {
    const style = this.stylesSignal.value.get(id);
    if (!style) return false;
    style.setProperties(props);
    this.stylesSignal.value = new Map(this.stylesSignal.value);
    return true;
  }

  duplicateStyle(sourceId: string, newId: string, newName: string): StyleClass | null {
    const source = this.stylesSignal.value.get(sourceId);
    if (!source) return null;
    if (this.hasStyle(newId)) {
      console.warn(`[StyleLibrary] Style id "${newId}" already exists`);
      return null;
    }
    const copy = source.clone(newId, newName);
    this.addStyle(copy);
    return copy;
  }

  generateCSS(): string {
    return this.getAllStyles()
      .map((style) => {
        const props = style.getProperties();
        const declarations = Object.entries(props)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([key, value]) => {
            const cssKey = key.replace(/([A-Z])/g, "-$1").toLowerCase();
            return `  ${cssKey}: ${value};`;
          })
          .join("\n");
        return `.editor-root .${style.getId()} {\n${declarations}\n}`;
      })
      .join("\n\n");
  }

  toJSON() {
    return this.getAllStyles().map((s) => s.toJSON());
  }

  static fromJSON(data: unknown[]): StyleLibrary {
    if (!Array.isArray(data)) return new StyleLibrary();
    const styles = (data as Parameters<typeof StyleClass.fromJSON>[0][]).map((item) => StyleClass.fromJSON(item));
    return new StyleLibrary(styles);
  }
}

const STYLE_ELEMENT_ID = "editor-styles";

export class StyleInjector {
  private library: StyleLibrary;
  private styleEl: HTMLStyleElement | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(library: StyleLibrary) {
    this.library = library;
  }

  mount(library?: StyleLibrary): void {
    if (library) {
      this.library = library;
    }
    this.styleEl = (document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null) ?? this.createStyleElement();

    this.unsubscribe = this.library.getStylesSignal().subscribe(() => {
      const css = this.library.generateCSS();
      if (this.styleEl) {
        this.styleEl.textContent = css;
      }
    });
  }

  swap(library: StyleLibrary): void {
    this.unmount();
    this.mount(library);
  }

  unmount(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  refresh(): void {
    if (this.styleEl) {
      this.styleEl.textContent = this.library.generateCSS();
    }
  }

  private createStyleElement(): HTMLStyleElement {
    const el = document.createElement("style");
    el.id = STYLE_ELEMENT_ID;
    el.type = "text/css";
    document.head.appendChild(el);
    return el;
  }
}

export interface BlockStyleReference {
  styleId: string;
  overrides?: CSSProperties;
}

export const defaultBlockStyles: Record<string, string> = {
  h1: "title",
  h2: "heading2",
  h3: "heading3",
  p: "body",
  ul: "body",
  ol: "body",
  li: "body",
  figcaption: "caption",
  code: "code",
  table: "table-info",
  pagebreak: "body",
  hbox: "footer-container",
  vbox: "footer-column",
  columns: "body",
  callout: "note",
  "raw-html": "body",
  embed: "body",
  reveal: "body",
  stream: "body",
  "nlp-block": "body",
  "nlp-tree": "body",
};
