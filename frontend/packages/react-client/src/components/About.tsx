import React from "react";
import Icon from "./Icon";

/**
 * About Component
 * A professional overview of the NLP Engine's technical architecture
 * and capabilities, featuring information cards and system specifications.
 */
const About: React.FC = () => {
  const features = [
    {
      title: "Streaming Architecture",
      desc: "Real-time Server-Sent Events (SSE) processing allows for handling massive payloads without blocking the UI thread, ensuring a fluid user experience during deep analysis.",
      icon: "analytics" as const,
      color: "blue",
    },
    {
      title: "Linguistic Core",
      desc: "Deep POS tagging, Lemmatization, and Entity Recognition powered by the C++23 engine. Optimized for low-latency execution and high-concurrency environments.",
      icon: "tree" as const,
      color: "indigo",
    },
    {
      title: "Thread-Safe Models",
      desc: "Atomic DataModel ensures dictionary updates and resource loading are safe across multiple concurrent requests using modern C++ memory primitives.",
      icon: "check" as const,
      color: "emerald",
    },
    {
      title: "Native Performance",
      desc: "Built with LLVM/Clang and specialized SIMD instructions where available, providing raw computational speed that interpreted languages cannot match.",
      icon: "settings" as const,
      color: "orange",
    },
    {
      title: "FastAPI Bridge",
      desc: "High-performance Python bindings using pybind11 provide a seamless bridge between the native C++ core and the modern asynchronous web stack.",
      icon: "copy" as const,
      color: "violet",
    },
    {
      title: "Safety & Toxicity",
      desc: "Integrated multi-category toxicity detection and content safety filters that run locally without sending data to external third-party APIs.",
      icon: "document" as const,
      color: "rose",
    },
  ];

  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-800",
    indigo:
      "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-800",
    emerald:
      "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800",
    orange:
      "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-800",
    violet:
      "bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 border-violet-100 dark:border-violet-800",
    rose: "bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 border-rose-100 dark:border-rose-800",
  };

  return (
    <div className="max-w-6xl mx-auto space-y-12 py-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Hero Section */}
      <section className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
          Technical Specifications
        </div>
        <h1 className="text-5xl font-black tracking-tighter text-slate-900 dark:text-white">
          Under the Hood
        </h1>
        <p className="max-w-2xl mx-auto text-slate-500 dark:text-slate-400 text-lg font-medium leading-relaxed">
          The NLP Studio is a demonstration of modern C++23 capabilities
          integrated into a distributed web environment.
        </p>
      </section>

      {/* Feature Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.map((f, i) => (
          <div
            key={i}
            className="group bg-white dark:bg-slate-900/50 backdrop-blur-sm border border-slate-200 dark:border-slate-800 rounded-3xl p-8 shadow-sm hover:shadow-xl hover:border-indigo-500/30 transition-all duration-300"
          >
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 border ${colorMap[f.color]}`}
            >
              <Icon name={f.icon} size="md" />
            </div>
            <h3 className="font-black text-xs uppercase tracking-widest mb-3 text-slate-800 dark:text-slate-200 group-hover:text-indigo-500 transition-colors">
              {f.title}
            </h3>
            <p className="text-slate-500 dark:text-slate-400 text-[13px] leading-relaxed font-medium">
              {f.desc}
            </p>
          </div>
        ))}
      </div>

      {/* Engineering Stats Section */}
      <section className="bg-slate-900 dark:bg-white rounded-[2.5rem] p-12 text-white dark:text-slate-900 overflow-hidden relative">
        <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none">
          <Icon name="analytics" size="lg" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
          <div className="space-y-6">
            <h2 className="text-3xl font-black tracking-tight leading-tight">
              Optimized for <br />
              <span className="text-indigo-400 dark:text-indigo-600">
                Sub-millisecond
              </span>{" "}
              Latency
            </h2>
            <p className="text-slate-400 dark:text-slate-500 text-base leading-relaxed">
              Our engine utilizes lock-free data structures for tokenization and
              memory-mapped dictionaries to ensure that linguistic processing
              never becomes the bottleneck in your pipeline.
            </p>
            <div className="flex flex-wrap gap-4">
              <div className="px-4 py-2 bg-slate-800 dark:bg-slate-100 rounded-xl border border-slate-700 dark:border-slate-200 font-mono text-xs">
                std::atomic_ref&lt;T&gt;
              </div>
              <div className="px-4 py-2 bg-slate-800 dark:bg-slate-100 rounded-xl border border-slate-700 dark:border-slate-200 font-mono text-xs">
                SIMD Vectorization
              </div>
              <div className="px-4 py-2 bg-slate-800 dark:bg-slate-100 rounded-xl border border-slate-700 dark:border-slate-200 font-mono text-xs">
                Zero-copy Buffers
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-800 dark:bg-slate-100 p-6 rounded-3xl border border-slate-700 dark:border-slate-200">
              <div className="text-3xl font-black mb-1">C++23</div>
              <div className="text-[10px] font-black uppercase tracking-widest opacity-50">
                Standard Core
              </div>
            </div>
            <div className="bg-slate-800 dark:bg-slate-100 p-6 rounded-3xl border border-slate-700 dark:border-slate-200">
              <div className="text-3xl font-black mb-1">~2ms</div>
              <div className="text-[10px] font-black uppercase tracking-widest opacity-50">
                Avg Response
              </div>
            </div>
            <div className="bg-slate-800 dark:bg-slate-100 p-6 rounded-3xl border border-slate-700 dark:border-slate-200">
              <div className="text-3xl font-black mb-1">100%</div>
              <div className="text-[10px] font-black uppercase tracking-widest opacity-50">
                Local Execution
              </div>
            </div>
            <div className="bg-slate-800 dark:bg-slate-100 p-6 rounded-3xl border border-slate-700 dark:border-slate-200">
              <div className="text-3xl font-black mb-1">0.1s</div>
              <div className="text-[10px] font-black uppercase tracking-widest opacity-50">
                Startup Time
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer Disclaimer */}
      <footer className="pt-8 pb-12 text-center">
        <p className="text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase tracking-widest">
          NLP Studio &copy; {new Date().getFullYear()} &bull; Built with C++,
          FastAPI, and React
        </p>
      </footer>
    </div>
  );
};

export default About;
