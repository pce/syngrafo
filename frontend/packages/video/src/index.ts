export type {
  VideoClipKind,
  VideoResolution,
  VideoSource,
  ShaderNodeType,
  ShaderNode,
  ShaderChain,
  VideoKeyframe,
  VideoEffect,
  VideoClip,
  VideoTrackLane,
  VideoProjectSettings,
  VideoProject,
} from './types/video.ts';
export { defaultProject, clipFromSource } from './types/video.ts';

export { videoStorage, VideoStorage }    from './storage/videoStorage.ts';
export type { VideoAsset }               from './storage/videoStorage.ts';

export {
  makeBlur,
  makeBrightnessContrast,
  makeOpacity,
  makeChromaKey,
  makeRotate,
  defaultChain,
  addNode,
  removeNode,
  moveNode,
  chainToJson,
  jsonToChain,
} from './effects/shaderChain.ts';

export { videoService }           from './ipc/video-service.ts';
export type {
  IpcResult,
  VideoExportResult,
  VideoFileInfo,
  ImageSequenceImportResult,
}                                  from './ipc/video-service.ts';

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

export { VideoEditorPage }              from './editor/VideoEditorPage.tsx';
export type { VideoEditorPageProps }    from './editor/VideoEditorPage.tsx';

// Note: exported under distinct names to avoid clashing with the ShaderNode/ShaderChain types.
export { ShaderChain as ShaderChainEditor } from './shaders/ShaderChain.tsx';
export { ShaderNode  as ShaderNodeCard }    from './shaders/ShaderNode.tsx';
export { FocusPicker }                      from './shaders/FocusPicker.tsx';
export type { ShaderChainConfig, ShaderNode as ShaderNodeConfig, FocusPoint, ShaderKind }
  from './types/shader.ts';
