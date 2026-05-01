import React, { useState, useEffect } from "react";
import Icon from "./Icon";
import { nlpService } from "../services/nlp-service";
import StatsDashboard from "./StatsDashboard";
import { useTheme } from "../hooks/useTheme";
import MarkovDropdown from "./header/MarkovDropdown";
import ToolkitDropdown from "./header/ToolkitDropdown";
import SystemDropdown from "./header/SystemDropdown";
import Tooltip from "./ui/Tooltip";
import ZoneNavigator from "./header/ZoneNavigator";

interface HeaderProps {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  active?: (path: string) => string;
  onContentChange?: (content: string, target?: "editor" | "output") => void;
  onAnalysisResults?: (results: string) => void;
  isGenerating?: boolean;
  setIsGenerating?: (isGenerating: boolean) => void;
}

/**
 * Header Component
 * Refactored to use a scalable, plugin-agnostic routing system.
 */
const Header: React.FC<HeaderProps> = ({
  sidebarOpen,
  setSidebarOpen,
  onContentChange,
  onAnalysisResults,
  isGenerating: externalIsGenerating,
  setIsGenerating: setExternalIsGenerating,
}) => {
  const { theme, setTheme, availableThemes } = useTheme();
  const [internalIsGenerating, setInternalIsGenerating] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("generic_novel");
  const [sessionId] = useState(
    () => `session_${Math.random().toString(36).substring(2, 11)}`,
  );

  const [genOptions, setGenOptions] = useState({
    length: 150,
    useHybrid: false,
    temperature: 1.0,
    top_p: 0.9,
    nGram: 2,
    fractalDepth: 3,
    fractalProb: 0.4,
  });

  const isGenerating =
    externalIsGenerating !== undefined
      ? externalIsGenerating
      : internalIsGenerating;
  const setIsGenerating = setExternalIsGenerating || setInternalIsGenerating;

  useEffect(() => {
    nlpService.getAvailableModels().then((models) => {
      if (models && models.length > 0) {
        setAvailableModels(models);
        if (models.includes("generic_novel")) setSelectedModel("generic_novel");
        else if (models[0]) setSelectedModel(models[0]);
      }
    });
  }, []);

  const handleAction = async (method: string, options: any = {}) => {
    const textareas = Array.from(document.querySelectorAll("textarea"));
    const visibleTextarea =
      textareas.find((t) => t.offsetParent !== null) || textareas[0];

    if (!visibleTextarea) return;

    setIsGenerating(true);
    try {
      const isFractal = method === "fractal" || method === "fractal_generator";
      const isDedupe = method === "dedupe" || method === "deduplication";
      const pluginName = isFractal
        ? "fractal_generator"
        : isDedupe
          ? "deduplication"
          : method;
      const currentText = visibleTextarea.value;

      let response;
      if (isDedupe) {
        response = await nlpService.analyze({
          seed: currentText,
          model: "deduplication",
          options: {
            ...options,
            mode: "detect",
            min_length: options.min_length || "1",
          },
        });
        onAnalysisResults?.(JSON.stringify(response, null, 2));
      } else {
        response = await nlpService.generateMarkov({
          seed: currentText,
          model: pluginName,
          options: {
            ...options,
            depth: genOptions.fractalDepth.toString(),
            probability: genOptions.fractalProb.toString(),
            n_gram: genOptions.nGram.toString(),
            length: genOptions.length.toString(),
          },
          temperature: genOptions.temperature,
          top_p: genOptions.top_p,
          length: genOptions.length,
        });

        if (isFractal) {
          onContentChange?.(response.output, "output");
        } else {
          onContentChange?.(response.output, "editor");
        }
      }
    } catch (error) {
      console.error(`[Header] ${method} failed:`, error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleTrain = async (category: string, ngram: number) => {
    const textarea = document.querySelector("textarea");
    if (!textarea || !textarea.value.trim()) return;

    setIsGenerating(true);
    try {
      const result = await nlpService.trainModel({
        category,
        text: textarea.value,
        ngram_size: ngram,
      });

      if (result.status === "success") {
        const models = await nlpService.getAvailableModels();
        setAvailableModels(models);
        setSelectedModel(result.model);
        onAnalysisResults?.(
          `[Log] Model training complete: ${result.model}\nN-Gram size: ${result.ngram_size}`,
        );
      }
    } catch (error) {
      console.error("Training failed:", error);
      onAnalysisResults?.(`[Error] Training failed: ${error}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = async (
    withInput: boolean = false,
    useStream: boolean = true,
  ) => {
    setIsGenerating(true);
    try {
      // Find the editor textarea specifically if it exists, otherwise fallback to visible
      const textareas = Array.from(document.querySelectorAll("textarea"));
      const editorTextarea =
        (document.querySelector("#editor-area") as HTMLTextAreaElement) ||
        textareas.find((t) => t.offsetParent !== null) ||
        textareas[0];
      const initialText = editorTextarea?.value || "";

      const seed = withInput
        ? editorTextarea?.selectionStart !== editorTextarea?.selectionEnd
          ? initialText.substring(
              editorTextarea!.selectionStart,
              editorTextarea!.selectionEnd,
            )
          : initialText.slice(-100)
        : "";
      const baseText = "";

      const request = {
        seed: seed || "The",
        length: genOptions.length,
        model: selectedModel,
        session_id: sessionId,
        temperature: genOptions.temperature,
        top_p: genOptions.top_p,
        n_gram: genOptions.nGram,
        use_hybrid: genOptions.useHybrid,
      };

      if (useStream) {
        let accumulated = "";
        await nlpService.generateMarkovStream(
          request,
          (chunk, is_final) => {
            accumulated += chunk;
            // Ensure we update the output textarea specifically
            onContentChange?.(baseText + accumulated, "output");
            if (is_final) setIsGenerating(false);
          },
          (err) => {
            console.error("Stream error:", err);
            setIsGenerating(false);
          },
        );
      } else {
        const res = await nlpService.generateMarkov(request);
        if (res.output) onContentChange?.(baseText + res.output, "output");
        setIsGenerating(false);
      }
    } catch (error) {
      console.error("Generation failed:", error);
      setIsGenerating(false);
    }
  };

  return (
    <header
      className="p-4 sticky top-0 z-40 shadow-sm border-b"
      style={{
        backgroundColor: "var(--theme-surface)",
        borderBottomColor: "var(--theme-border)",
      }}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Tooltip content={sidebarOpen ? "Close Sidebar" : "Open Sidebar"}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg transition-colors hover:opacity-80"
              style={{ color: "var(--theme-text-muted)" }}
            >
              <Icon name="columns" size="sm" />
            </button>
          </Tooltip>

          <div
            className="h-6 w-px mx-2"
            style={{ backgroundColor: "var(--theme-border)" }}
          />

          <h1
            className="text-sm font-black uppercase tracking-tighter"
            style={{ color: "var(--theme-text)" }}
          >
            SYNGRAFO<span style={{ color: "var(--theme-primary)" }}>DMS</span>
          </h1>

          <div
            className="h-6 w-px mx-2"
            style={{ backgroundColor: "var(--theme-border)" }}
          />

          <ZoneNavigator />
        </div>

        <div className="flex items-center gap-4">
          <MarkovDropdown
            isGenerating={isGenerating}
            selectedModel={selectedModel}
            availableModels={availableModels}
            setSelectedModel={setSelectedModel}
            genOptions={genOptions}
            setGenOptions={setGenOptions}
            onGenerate={handleGenerate}
            onAction={(method, options) =>
              handleAction(
                method === "fractal" ? "fractal_generator" : method,
                options,
              )
            }
          />

          <ToolkitDropdown
            onAction={(method, options) =>
              handleAction(
                method === "dedupe" ? "deduplication" : method,
                options,
              )
            }
          />

          <SystemDropdown
            theme={theme}
            setTheme={(t: string) => setTheme(t as any)}
            availableThemes={availableThemes}
          />

          <div
            className="flex items-center gap-2 pl-2 border-l"
            style={{ borderLeftColor: "var(--theme-border)" }}
          >
            <StatsDashboard />
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
