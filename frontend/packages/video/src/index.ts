export type {
  VideoClipKind,
  VideoResolution,
  VideoSource,
  VideoKeyframe,
  VideoEffect,
  VideoClip,
  VideoTrackLane,
  VideoProjectSettings,
  VideoProject,
} from './types/video.ts';
export { defaultProject, clipFromSource } from './types/video.ts';

export type {
  ShaderKind,
  FocusPoint,
  ShaderParams,
  ShaderNode,
  ShaderChainConfig,
} from './types/shader.ts';

export type {
  FadeInOp,
  FadeOutOp,
  TransitionOp,
  SpeedRampOp,
  KenBurnsOp,
  VideoOperator,
} from './types/effect.ts';

export {
  makeKenBurns,
  makeMirror,
  makeFlip,
  makeScaleIn,
  makeScaleOut,
  makeKaleidoscope,
  makeBlackhole,
  makeNoise,
  makeBlur,
  makeDof,
  makeTiltBlur,
  makeCinema,
  makeFade,
  defaultChain,
  addNode,
  removeNode,
  moveNode,
  chainToJson,
  jsonToChain,
} from './effects/shaderChain.ts';

import { videoStorage } from './storage/videoStorage.ts';
export { videoStorage };
/** Inferred shape of the {@link videoStorage} singleton. */
export type VideoStorage = typeof videoStorage;
export type { VideoAsset } from './storage/videoStorage.ts';

export { videoService } from './ipc/video-service.ts';
export type {
  IpcResult,
  VideoExportResult,
  VideoFileInfo,
  ImageSequenceImportResult,
} from './ipc/video-service.ts';

export { SceneCompositor } from './gpu/SceneCompositor.ts';

export { Ruler }                   from './timeline/Ruler.tsx';
export type { RulerProps }         from './timeline/Ruler.tsx';
export { ClipBlock }               from './timeline/ClipBlock.tsx';
export type { ClipBlockProps }     from './timeline/ClipBlock.tsx';
export { TrackHeader }             from './timeline/TrackHeader.tsx';
export type { TrackHeaderProps }   from './timeline/TrackHeader.tsx';
export { VideoTimeline }           from './timeline/VideoTimeline.tsx';
export type { VideoTimelineProps } from './timeline/VideoTimeline.tsx';

export { VideoPreview }            from './preview/VideoPreview.tsx';
export type { VideoPreviewProps }  from './preview/VideoPreview.tsx';

export { VideoEditorPage }           from './editor/VideoEditorPage.tsx';
export type { VideoEditorPageProps } from './editor/VideoEditorPage.tsx';

export { ShaderChain as ShaderChainEditor } from './shaders/ShaderChain.tsx';
export { ShaderNode  as ShaderNodeCard }    from './shaders/ShaderNode.tsx';
export { FocusPicker }                      from './shaders/FocusPicker.tsx';

export { Icon }                              from '@syngrafo/ui';
export type { IconName, IconSize, IconProps } from '@syngrafo/ui';

export { FileBrowser }                                               from '@syngrafo/ui';
export type { FileBrowserEntry, FileBrowserViewMode, FileBrowserProps } from '@syngrafo/ui';

export { AssetBrowser }            from './browser/AssetBrowser.tsx';
export type { AssetBrowserProps }  from './browser/AssetBrowser.tsx';
