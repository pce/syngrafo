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
export type { FitMode, ClipLayout, RenderPass } from './types/video.ts';

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
  StretchMorphOp,
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
  makeBloom,
  makeBokehGlow,
  makeChromaticWarp,
  makeFlowWarp,
  makeDuotone,
  makeTritone,
  makeFilmGrain,
  makeRoundedFrame,
  makeFade,
  defaultChain,
  addNode,
  removeNode,
  moveNode,
  chainToJson,
  jsonToChain,
} from './effects/shaderChain.ts';

export type {
  LookPresetId,
  LookPreset,
} from './types/look.ts';
export { LOOK_PRESETS, getLookPreset } from './types/look.ts';

export type { SequenceImportConfig, SeqImportMode, SeqTransition } from './types/sequence.ts';
export { SEQ_IMPORT_DEFAULTS } from './types/sequence.ts';

import { videoStorage } from './storage/videoStorage.ts';
export { videoStorage };
/** Inferred shape of the {@link videoStorage} singleton. */
export type VideoStorage = typeof videoStorage;
export type { VideoAsset } from './storage/videoStorage.ts';

export { videoService } from './ipc/video-service.ts';
export type {
  IpcResult,
  VideoExportResult,
  VideoReverseResult,
  VideoMediaInfo,
  VideoDecodedFrame,
  VideoImportClipResult,
  VideoListDirResult,
} from './ipc/video-service.ts';

export * from './engine/index.ts';

export { SceneCompositor } from './gpu/SceneCompositor.ts';

export { buildMorphColorNode } from './gpu/tsl/operators.ts';

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

export { ClipInspector }             from './editor/ClipInspector.tsx';
export type { ClipInspectorProps }   from './editor/ClipInspector.tsx';

export { ShaderChain as ShaderChainEditor } from './shaders/ShaderChain.tsx';
export { ShaderNode  as ShaderNodeCard }    from './shaders/ShaderNode.tsx';
export { FocusPicker }                      from './shaders/FocusPicker.tsx';

export { Icon }                              from '@syngrafo/ui';
export type { IconName, IconSize, IconProps } from '@syngrafo/ui';

export { FileBrowser }                                               from '@syngrafo/ui';
export type { FileBrowserEntry, FileBrowserViewMode, FileBrowserProps } from '@syngrafo/ui';

export { AssetBrowser }            from './browser/AssetBrowser.tsx';
export type { AssetBrowserProps }  from './browser/AssetBrowser.tsx';

export { PlasmaPreview }           from './browser/PlasmaPreview.tsx';
export type { PlasmaPreviewProps } from './browser/PlasmaPreview.tsx';

export { SequenceImportDialog }           from './browser/SequenceImportDialog.tsx';
export type { SequenceImportDialogProps } from './browser/SequenceImportDialog.tsx';
