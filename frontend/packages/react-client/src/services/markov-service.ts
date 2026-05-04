import { binding, call, type NlpEnvelope } from "./nlp-service";

export interface MarkovRequest {
  seed?:        string;
  model?:       string;
  category?:    string;
  text?:        string;
  options?:     Record<string, string>;
  temperature?: number;
  top_p?:       number;
  length?:      number;
  session_id?:  string;
  n_gram?:      number;
  use_hybrid?:  boolean;
  ngram_size?:  number;
}

export interface MarkovResult { output: string; }

export interface TrainRequest {
  category:   string;
  text:       string;
  ngram_size: number;
}

export interface TrainResult {
  status:     string;
  model:      string;
  ngram_size: number;
}

export const markov = {
  getAvailableModels: (): Promise<NlpEnvelope<string[]>> =>
    call<string[]>(binding("markov_get_models")),

  generate: (req: MarkovRequest): Promise<NlpEnvelope<MarkovResult>> =>
    call<MarkovResult>(binding("markov_generate"), JSON.stringify(req)),

  /**
   * Wraps `markov_generate` as a single-delivery "stream" — saucer IPC is
   * one-shot Promise, so the full output arrives as one final chunk.
   * A dedicated streaming binding (`markov_stream`) can be swapped in
   * without changing the call-site signature.
   */
  generateStream: async (
    req:     MarkovRequest,
    onChunk: (chunk: string, is_final: boolean) => void,
    onError: (err: unknown) => void,
  ): Promise<void> => {
    const fn = binding("markov_stream") ?? binding("markov_generate");
    const res = await call<MarkovResult>(fn, JSON.stringify(req));
    if (res.ok && res.data) onChunk(res.data.output, true);
    else onError(res.error ?? "Unknown error");
  },

  train: (req: TrainRequest): Promise<NlpEnvelope<TrainResult>> =>
    call<TrainResult>(binding("markov_train"), JSON.stringify(req)),

  analyze: (req: MarkovRequest): Promise<NlpEnvelope<unknown>> =>
    call<unknown>(binding("markov_analyze"), JSON.stringify(req)),
};
