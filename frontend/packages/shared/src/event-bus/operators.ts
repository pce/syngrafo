import { EventBus } from "./EventBus";
import type { VideoEventMap, AudioEventMap } from "../types/events";

/** Singleton video event bus — import and use anywhere in the video package. */
export const videoBus = new EventBus<VideoEventMap>();

/** Singleton audio event bus — import and use anywhere in the audio package. */
export const audioBus = new EventBus<AudioEventMap>();
