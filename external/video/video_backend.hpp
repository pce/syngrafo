#pragma once
/**
 * video_backend.hpp — FFmpeg video decode/info backend.
 *
 * Uses libavformat, libavcodec, libavutil, libswscale as LINKED LIBRARIES.
 * NO subprocess spawning. NO ffmpeg binary invocation.
 * Compiled only when SGF_WITH_VIDEO=ON.
 */

#include <string>
#include <filesystem>
#include <vector>
#include <expected>
#include <cstdint>

#ifdef SGF_WITH_VIDEO
extern "C" {
#  include <libavformat/avformat.h>
#  include <libavcodec/avcodec.h>
#  include <libavutil/avutil.h>
#  include <libavutil/imgutils.h>
#  include <libavutil/opt.h>
#  include <libswscale/swscale.h>
}
#endif
#include <algorithm>
#include <array>
#include <memory>
#include <optional>

namespace pce::video {

struct MediaInfo {
    int    width           = 0;
    int    height          = 0;
    double fps             = 0.0;
    double duration_sec    = 0.0;
    int    duration_frames = 0;
    std::string codec;
    bool   has_audio       = false;
};

struct FrameData {
    std::vector<uint8_t> jpeg_bytes;   // JPEG-encoded frame bytes
    int    width         = 0;
    int    height        = 0;
    int    frame_number  = 0;
    double timestamp_sec = 0.0;
};

/**
 * Get media information for a video file using libavformat.
 * Never spawns a subprocess.
 */
inline std::expected<MediaInfo, std::string>
get_media_info(const std::filesystem::path& path)
{
#ifndef SGF_WITH_VIDEO
    return std::unexpected("Video backend not compiled (SGF_WITH_VIDEO=OFF)");
#else
    AVFormatContext* fmt_ctx = nullptr;
    if (avformat_open_input(&fmt_ctx, path.c_str(), nullptr, nullptr) < 0)
        return std::unexpected("Cannot open file: " + path.string());

    struct Guard {
        AVFormatContext* p;
        ~Guard() { avformat_close_input(&p); }
    } guard{fmt_ctx};

    if (avformat_find_stream_info(fmt_ctx, nullptr) < 0)
        return std::unexpected("Cannot read stream info");

    MediaInfo info;
    info.duration_sec = (fmt_ctx->duration != AV_NOPTS_VALUE)
        ? static_cast<double>(fmt_ctx->duration) / AV_TIME_BASE
        : 0.0;

    for (unsigned i = 0; i < fmt_ctx->nb_streams; ++i) {
        const AVStream* s = fmt_ctx->streams[i];
        if (s->codecpar->codec_type == AVMEDIA_TYPE_VIDEO && info.width == 0) {
            info.width  = s->codecpar->width;
            info.height = s->codecpar->height;
            const AVCodecDescriptor* desc = avcodec_descriptor_get(s->codecpar->codec_id);
            info.codec = desc ? desc->name : "unknown";
            if (s->avg_frame_rate.den > 0)
                info.fps = av_q2d(s->avg_frame_rate);
            if (info.fps > 0.0 && info.duration_sec > 0.0)
                info.duration_frames = static_cast<int>(info.duration_sec * info.fps + 0.5);
        }
        if (s->codecpar->codec_type == AVMEDIA_TYPE_AUDIO)
            info.has_audio = true;
    }

    return info;
#endif
}

/**
 * Decode a single video frame using libavcodec.
 * Seeks to the requested frame, decodes, and returns JPEG bytes.
 * Never spawns a subprocess.
 *
 * @param path         source video file
 * @param frame_number 0-based frame index
 * @param fps          frame rate (used to compute the target PTS)
 */
inline std::expected<FrameData, std::string>
decode_frame(const std::filesystem::path& path, int frame_number, double fps)
{
#ifndef SGF_WITH_VIDEO
    return std::unexpected("Video backend not compiled (SGF_WITH_VIDEO=OFF)");
#else
    AVFormatContext* fmt_ctx = nullptr;
    if (avformat_open_input(&fmt_ctx, path.c_str(), nullptr, nullptr) < 0)
        return std::unexpected("Cannot open: " + path.string());

    struct FmtGuard {
        AVFormatContext* p;
        ~FmtGuard() { avformat_close_input(&p); }
    } fg{fmt_ctx};

    if (avformat_find_stream_info(fmt_ctx, nullptr) < 0)
        return std::unexpected("Cannot read stream info");

    // Find best video stream
    const int stream_idx =
        av_find_best_stream(fmt_ctx, AVMEDIA_TYPE_VIDEO, -1, -1, nullptr, 0);
    if (stream_idx < 0)
        return std::unexpected("No video stream found");

    AVStream* stream = fmt_ctx->streams[stream_idx];

    const AVCodec* codec = avcodec_find_decoder(stream->codecpar->codec_id);
    if (!codec)
        return std::unexpected("No decoder for codec");

    AVCodecContext* codec_ctx = avcodec_alloc_context3(codec);
    avcodec_parameters_to_context(codec_ctx, stream->codecpar);

    struct CodecGuard {
        AVCodecContext* p;
        ~CodecGuard() { avcodec_free_context(&p); }
    } cg{codec_ctx};

    if (avcodec_open2(codec_ctx, codec, nullptr) < 0)
        return std::unexpected("Cannot open codec");

    // Seek to the target frame (backward seek ensures we land on a keyframe)
    const double  target_sec = (fps > 0.0) ? (frame_number / fps) : 0.0;
    const int64_t target_ts  =
        static_cast<int64_t>(target_sec / av_q2d(stream->time_base));
    av_seek_frame(fmt_ctx, stream_idx, target_ts, AVSEEK_FLAG_BACKWARD);
    avcodec_flush_buffers(codec_ctx);

    AVPacket* pkt = av_packet_alloc();
    AVFrame*  frm = av_frame_alloc();

    struct PktGuard { AVPacket* p; ~PktGuard() { av_packet_free(&p); } } pg{pkt};
    struct FrmGuard { AVFrame*  f; ~FrmGuard() { av_frame_free(&f); }  } ffg{frm};

    FrameData result;
    bool found = false;

    while (!found && av_read_frame(fmt_ctx, pkt) >= 0) {
        if (pkt->stream_index != stream_idx) {
            av_packet_unref(pkt);
            continue;
        }
        if (avcodec_send_packet(codec_ctx, pkt) < 0) {
            av_packet_unref(pkt);
            continue;
        }

        while (avcodec_receive_frame(codec_ctx, frm) == 0) {
            result.timestamp_sec = (frm->pts != AV_NOPTS_VALUE)
                ? frm->pts * av_q2d(stream->time_base)
                : 0.0;

            // Accept the first frame at or past the target timestamp
            const double half_frame = (fps > 0.0) ? (0.5 / fps) : 0.0;
            if (result.timestamp_sec >= target_sec - half_frame || !found) {
                result.width        = frm->width;
                result.height       = frm->height;
                result.frame_number = frame_number;

                // Convert source pixel format to RGB24
                SwsContext* sws = sws_getContext(
                    frm->width, frm->height, static_cast<AVPixelFormat>(frm->format),
                    frm->width, frm->height, AV_PIX_FMT_RGB24,
                    SWS_BILINEAR, nullptr, nullptr, nullptr);
                if (!sws) break;
                struct SwsGuard {
                    SwsContext* s;
                    ~SwsGuard() { sws_freeContext(s); }
                } sg{sws};

                AVFrame* rgb_frame = av_frame_alloc();
                rgb_frame->format = AV_PIX_FMT_RGB24;
                rgb_frame->width  = frm->width;
                rgb_frame->height = frm->height;
                av_image_alloc(rgb_frame->data, rgb_frame->linesize,
                    frm->width, frm->height, AV_PIX_FMT_RGB24, 1);

                sws_scale(sws,
                    frm->data, frm->linesize, 0, frm->height,
                    rgb_frame->data, rgb_frame->linesize);

                // RGB24 → YUVJ420P → MJPEG encode
                const AVCodec* jpg_codec = avcodec_find_encoder(AV_CODEC_ID_MJPEG);
                if (jpg_codec) {
                    AVCodecContext* jpg_ctx = avcodec_alloc_context3(jpg_codec);
                    jpg_ctx->width     = frm->width;
                    jpg_ctx->height    = frm->height;
                    jpg_ctx->pix_fmt   = AV_PIX_FMT_YUVJ420P;
                    jpg_ctx->time_base = {1, 25};
                    avcodec_open2(jpg_ctx, jpg_codec, nullptr);

                    SwsContext* sws2 = sws_getContext(
                        frm->width, frm->height, AV_PIX_FMT_RGB24,
                        frm->width, frm->height, AV_PIX_FMT_YUVJ420P,
                        SWS_BILINEAR, nullptr, nullptr, nullptr);

                    AVFrame* yuv_frame = av_frame_alloc();
                    yuv_frame->format = AV_PIX_FMT_YUVJ420P;
                    yuv_frame->width  = frm->width;
                    yuv_frame->height = frm->height;
                    av_image_alloc(yuv_frame->data, yuv_frame->linesize,
                        frm->width, frm->height, AV_PIX_FMT_YUVJ420P, 1);

                    sws_scale(sws2,
                        rgb_frame->data, rgb_frame->linesize, 0, frm->height,
                        yuv_frame->data, yuv_frame->linesize);

                    AVPacket* jpg_pkt = av_packet_alloc();
                    if (avcodec_send_frame(jpg_ctx, yuv_frame) == 0 &&
                        avcodec_receive_packet(jpg_ctx, jpg_pkt) == 0) {
                        result.jpeg_bytes.assign(
                            jpg_pkt->data,
                            jpg_pkt->data + jpg_pkt->size);
                    }
                    av_packet_free(&jpg_pkt);
                    av_freep(&yuv_frame->data[0]);
                    av_frame_free(&yuv_frame);
                    sws_freeContext(sws2);
                    avcodec_free_context(&jpg_ctx);
                }

                av_freep(&rgb_frame->data[0]);
                av_frame_free(&rgb_frame);
                found = true;
                break;
            }
        }
        av_packet_unref(pkt);
    }

    if (!found || result.jpeg_bytes.empty())
        return std::unexpected(
            "Could not decode frame " + std::to_string(frame_number));

    return result;
#endif
}

// ── Export types (always visible so the binding compiles even without FFmpeg) ──

enum class ExportClipKind { Video, Image, SolidColor, Audio };

struct ExportClip {
    ExportClipKind        kind         = ExportClipKind::SolidColor;
    std::string           source_path;
    std::array<uint8_t,3> color        = {0,0,0};
    int    start_frame   = 0;
    int    end_frame     = 0;
    int    source_offset = 0;
    int    layer         = 0;
    double opacity       = 1.0;
    bool   muted         = false;
};

struct ExportProject {
    int    width           = 1920;
    int    height          = 1080;
    double fps             = 25.0;
    int    duration_frames = 0;
    std::array<uint8_t,3> bg_color = {0,0,0};
    std::vector<ExportClip> clips;  // pre-sorted by layer ascending
};

struct ExportResult {
    std::string output_path;
    double      duration_sec = 0.0;
    int         frame_count  = 0;
};

#ifdef SGF_WITH_VIDEO

/**
 * RAII sequential decoder — opens a video/image file once and exposes
 * read_rgb() for per-frame compositing without repeated seeks.
 */
class VideoClipDecoder {
public:
    explicit VideoClipDecoder(const std::filesystem::path& path) {
        if (avformat_open_input(&fmt_ctx_, path.c_str(), nullptr, nullptr) < 0) return;
        if (avformat_find_stream_info(fmt_ctx_, nullptr) < 0) {
            avformat_close_input(&fmt_ctx_); fmt_ctx_ = nullptr; return;
        }
        stream_idx_ = av_find_best_stream(fmt_ctx_, AVMEDIA_TYPE_VIDEO, -1, -1, nullptr, 0);
        if (stream_idx_ < 0) { avformat_close_input(&fmt_ctx_); fmt_ctx_ = nullptr; return; }

        AVStream* st = fmt_ctx_->streams[stream_idx_];
        width_  = st->codecpar->width;
        height_ = st->codecpar->height;
        time_base_ = st->time_base;
        if (st->avg_frame_rate.den > 0) fps_ = av_q2d(st->avg_frame_rate);

        const AVCodec* codec = avcodec_find_decoder(st->codecpar->codec_id);
        if (!codec) { avformat_close_input(&fmt_ctx_); fmt_ctx_ = nullptr; return; }
        codec_ctx_ = avcodec_alloc_context3(codec);
        avcodec_parameters_to_context(codec_ctx_, st->codecpar);
        if (avcodec_open2(codec_ctx_, codec, nullptr) < 0) {
            avcodec_free_context(&codec_ctx_); avformat_close_input(&fmt_ctx_);
            fmt_ctx_ = nullptr; codec_ctx_ = nullptr; return;
        }
        frame_ = av_frame_alloc();
        pkt_   = av_packet_alloc();
        ok_    = true;
    }

    ~VideoClipDecoder() {
        if (sws_ctx_)   sws_freeContext(sws_ctx_);
        if (pkt_)       av_packet_free(&pkt_);
        if (frame_)     av_frame_free(&frame_);
        if (codec_ctx_) avcodec_free_context(&codec_ctx_);
        if (fmt_ctx_)   avformat_close_input(&fmt_ctx_);
    }

    bool   ok()     const { return ok_; }
    int    width()  const { return width_; }
    int    height() const { return height_; }
    double fps()    const { return fps_; }

    /** Seek approximately to frame_number (backward to nearest keyframe). */
    bool seek_to(int frame_number) {
        if (!ok_) return false;
        const double   sec = (fps_ > 0.0) ? (frame_number / fps_) : 0.0;
        const int64_t  ts  = static_cast<int64_t>(sec / av_q2d(time_base_));
        if (av_seek_frame(fmt_ctx_, stream_idx_, ts, AVSEEK_FLAG_BACKWARD) < 0) return false;
        avcodec_flush_buffers(codec_ctx_);
        return true;
    }

    /** Read the next decoded frame and scale it to out_w × out_h as RGB24.
     *  Returns nullopt when the source is exhausted or on error. */
    std::optional<std::vector<uint8_t>> read_rgb(int out_w, int out_h) {
        if (!ok_) return std::nullopt;

        // Refresh sws context when output dimensions change
        if (!sws_ctx_ || sws_out_w_ != out_w || sws_out_h_ != out_h) {
            if (sws_ctx_) sws_freeContext(sws_ctx_);
            sws_ctx_ = nullptr;
            sws_out_w_ = out_w;
            sws_out_h_ = out_h;
        }

        bool got = false;
        while (!got) {
            int ret = avcodec_receive_frame(codec_ctx_, frame_);
            if (ret == 0) { got = true; break; }
            if (ret == AVERROR_EOF) return std::nullopt;
            if (ret != AVERROR(EAGAIN)) return std::nullopt;
            // Need more packets
            ret = av_read_frame(fmt_ctx_, pkt_);
            if (ret < 0) {
                avcodec_send_packet(codec_ctx_, nullptr); // flush
                continue;
            }
            if (pkt_->stream_index == stream_idx_)
                avcodec_send_packet(codec_ctx_, pkt_);
            av_packet_unref(pkt_);
        }
        if (!got) return std::nullopt;

        // Lazy-init sws once we know the decoded frame format
        if (!sws_ctx_) {
            sws_ctx_ = sws_getContext(
                frame_->width, frame_->height,
                static_cast<AVPixelFormat>(frame_->format),
                out_w, out_h, AV_PIX_FMT_RGB24,
                SWS_BILINEAR, nullptr, nullptr, nullptr);
            if (!sws_ctx_) return std::nullopt;
        }

        std::vector<uint8_t> rgb(out_w * out_h * 3);
        uint8_t* dst[1]  = { rgb.data() };
        int   stride[1]  = { out_w * 3 };
        sws_scale(sws_ctx_, frame_->data, frame_->linesize, 0, frame_->height, dst, stride);
        return rgb;
    }

private:
    AVFormatContext* fmt_ctx_   = nullptr;
    AVCodecContext*  codec_ctx_ = nullptr;
    AVFrame*         frame_     = nullptr;
    AVPacket*        pkt_       = nullptr;
    SwsContext*      sws_ctx_   = nullptr;
    AVRational       time_base_ = {1, 1};
    int    stream_idx_  = -1;
    int    width_       = 0;
    int    height_      = 0;
    double fps_         = 0.0;
    int    sws_out_w_   = 0;
    int    sws_out_h_   = 0;
    bool   ok_          = false;
};

/**
 * Export a VideoProject to an mp4 file.
 * Composites all non-audio, non-muted clips in layer order per frame.
 * Audio clips are skipped (audio track export not yet implemented).
 */
inline std::expected<ExportResult, std::string>
export_project(const ExportProject& proj, const std::filesystem::path& output_path)
{
    if (proj.duration_frames <= 0)
        return std::unexpected("Project has no frames to export");
    if (proj.width <= 0 || proj.height <= 0)
        return std::unexpected("Invalid project resolution");

    const std::string out_str = output_path.string();
    const int    W   = proj.width;
    const int    H   = proj.height;
    const double fps = proj.fps > 0.0 ? proj.fps : 25.0;
    // Use 90 kHz timebase (standard for mp4)
    const int TB_NUM = 1, TB_DEN = 90000;
    const int64_t pts_step = static_cast<int64_t>(TB_DEN / fps);

    // ── Output muxer ────────────────────────────────────────────────────────
    AVFormatContext* out_ctx = nullptr;
    if (avformat_alloc_output_context2(&out_ctx, nullptr, nullptr, out_str.c_str()) < 0)
        return std::unexpected("Cannot create output context: " + out_str);

    // Encoder selection: prefer libx264, fallback to native H.264, then MPEG4
    const AVCodec* enc = avcodec_find_encoder_by_name("libx264");
    if (!enc) enc = avcodec_find_encoder(AV_CODEC_ID_H264);
    if (!enc) enc = avcodec_find_encoder(AV_CODEC_ID_MPEG4);
    if (!enc) {
        avformat_free_context(out_ctx);
        return std::unexpected("No suitable video encoder found");
    }

    AVStream* out_stream = avformat_new_stream(out_ctx, enc);
    if (!out_stream) {
        avformat_free_context(out_ctx);
        return std::unexpected("Cannot create output stream");
    }

    AVCodecContext* enc_ctx = avcodec_alloc_context3(enc);
    if (!enc_ctx) {
        avformat_free_context(out_ctx);
        return std::unexpected("Cannot allocate encoder context");
    }

    enc_ctx->width        = W;
    enc_ctx->height       = H;
    enc_ctx->pix_fmt      = AV_PIX_FMT_YUV420P;
    enc_ctx->time_base    = AVRational{TB_NUM, TB_DEN};
    enc_ctx->framerate    = AVRational{static_cast<int>(fps * 1000 + 0.5), 1000};
    enc_ctx->gop_size     = 12;
    enc_ctx->max_b_frames = 0;
    if (out_ctx->oformat->flags & AVFMT_GLOBALHEADER)
        enc_ctx->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;

    // libx264-specific quality settings (ignored for other encoders)
    av_opt_set(enc_ctx->priv_data, "preset", "fast", 0);
    av_opt_set(enc_ctx->priv_data, "crf",    "23",   0);

    AVDictionary* enc_opts = nullptr;
    if (avcodec_open2(enc_ctx, enc, &enc_opts) < 0) {
        av_dict_free(&enc_opts);
        avcodec_free_context(&enc_ctx);
        avformat_free_context(out_ctx);
        return std::unexpected("Cannot open encoder");
    }
    av_dict_free(&enc_opts);

    avcodec_parameters_from_context(out_stream->codecpar, enc_ctx);
    out_stream->time_base = enc_ctx->time_base;

    if (!(out_ctx->oformat->flags & AVFMT_NOFILE)) {
        if (avio_open(&out_ctx->pb, out_str.c_str(), AVIO_FLAG_WRITE) < 0) {
            avcodec_free_context(&enc_ctx);
            avformat_free_context(out_ctx);
            return std::unexpected("Cannot open output file: " + out_str);
        }
    }
    if (avformat_write_header(out_ctx, nullptr) < 0) {
        avcodec_free_context(&enc_ctx);
        if (!(out_ctx->oformat->flags & AVFMT_NOFILE)) avio_closep(&out_ctx->pb);
        avformat_free_context(out_ctx);
        return std::unexpected("Cannot write mp4 header");
    }

    // ── Working buffers ─────────────────────────────────────────────────────
    std::vector<uint8_t> canvas(W * H * 3);  // RGB24

    AVFrame* yuv_frame = av_frame_alloc();
    yuv_frame->format = AV_PIX_FMT_YUV420P;
    yuv_frame->width  = W;
    yuv_frame->height = H;
    av_image_alloc(yuv_frame->data, yuv_frame->linesize, W, H, AV_PIX_FMT_YUV420P, 32);

    SwsContext* rgb2yuv = sws_getContext(
        W, H, AV_PIX_FMT_RGB24,
        W, H, AV_PIX_FMT_YUV420P,
        SWS_BILINEAR, nullptr, nullptr, nullptr);

    AVPacket* out_pkt = av_packet_alloc();

    // ── Open one decoder per visual clip ────────────────────────────────────
    std::vector<std::unique_ptr<VideoClipDecoder>> decoders(proj.clips.size());
    for (std::size_t i = 0; i < proj.clips.size(); ++i) {
        const auto& c = proj.clips[i];
        if ((c.kind == ExportClipKind::Video || c.kind == ExportClipKind::Image)
            && !c.source_path.empty()) {
            decoders[i] = std::make_unique<VideoClipDecoder>(c.source_path);
            if (decoders[i]->ok() && c.source_offset > 0)
                decoders[i]->seek_to(c.source_offset);
        }
    }

    // ── Helper: drain encoder into output ───────────────────────────────────
    auto drain_encoder = [&]() {
        while (true) {
            int r = avcodec_receive_packet(enc_ctx, out_pkt);
            if (r == AVERROR(EAGAIN) || r == AVERROR_EOF) break;
            if (r < 0) break;
            av_packet_rescale_ts(out_pkt, enc_ctx->time_base, out_stream->time_base);
            out_pkt->stream_index = out_stream->index;
            av_interleaved_write_frame(out_ctx, out_pkt);
            av_packet_unref(out_pkt);
        }
    };

    // ── Main compositing loop ────────────────────────────────────────────────
    std::string loop_error;
    for (int t = 0; t < proj.duration_frames && loop_error.empty(); ++t) {
        // Fill canvas with background colour
        for (int i = 0; i < W * H; ++i) {
            canvas[i*3+0] = proj.bg_color[0];
            canvas[i*3+1] = proj.bg_color[1];
            canvas[i*3+2] = proj.bg_color[2];
        }

        // Composite clips in layer order (lowest layer first)
        for (std::size_t ci = 0; ci < proj.clips.size(); ++ci) {
            const auto& c = proj.clips[ci];
            if (c.muted || t < c.start_frame || t > c.end_frame) continue;

            if (c.kind == ExportClipKind::SolidColor) {
                const double  a  = c.opacity;
                const double  ia = 1.0 - a;
                for (int i = 0; i < W * H; ++i) {
                    canvas[i*3+0] = static_cast<uint8_t>(c.color[0] * a + canvas[i*3+0] * ia);
                    canvas[i*3+1] = static_cast<uint8_t>(c.color[1] * a + canvas[i*3+1] * ia);
                    canvas[i*3+2] = static_cast<uint8_t>(c.color[2] * a + canvas[i*3+2] * ia);
                }
            } else if ((c.kind == ExportClipKind::Video || c.kind == ExportClipKind::Image)
                       && decoders[ci] && decoders[ci]->ok()) {
                auto rgb = decoders[ci]->read_rgb(W, H);
                if (rgb) {
                    const double  a  = c.opacity;
                    const double  ia = 1.0 - a;
                    const auto&   px = *rgb;
                    for (int i = 0; i < W * H * 3; ++i)
                        canvas[i] = static_cast<uint8_t>(px[i] * a + canvas[i] * ia);
                }
            }
            // Audio clips: skip (no video contribution)
        }

        // RGB24 canvas → YUV420P
        const uint8_t* src_p[1]  = { canvas.data() };
        const int      src_s[1]  = { W * 3 };
        sws_scale(rgb2yuv, src_p, src_s, 0, H, yuv_frame->data, yuv_frame->linesize);
        yuv_frame->pts = static_cast<int64_t>(t) * pts_step;

        if (avcodec_send_frame(enc_ctx, yuv_frame) < 0) {
            loop_error = "Encoder send failed at frame " + std::to_string(t);
        }
        drain_encoder();
    }

    // Flush encoder
    avcodec_send_frame(enc_ctx, nullptr);
    drain_encoder();
    av_write_trailer(out_ctx);

    // Cleanup
    sws_freeContext(rgb2yuv);
    av_freep(&yuv_frame->data[0]);
    av_frame_free(&yuv_frame);
    av_packet_free(&out_pkt);
    avcodec_free_context(&enc_ctx);
    if (!(out_ctx->oformat->flags & AVFMT_NOFILE)) avio_closep(&out_ctx->pb);
    avformat_free_context(out_ctx);

    if (!loop_error.empty())
        return std::unexpected(loop_error);

    return ExportResult{
        out_str,
        static_cast<double>(proj.duration_frames) / fps,
        proj.duration_frames,
    };
}

#else  // !SGF_WITH_VIDEO stub

inline std::expected<ExportResult, std::string>
export_project(const ExportProject&, const std::filesystem::path&) {
    return std::unexpected("Video backend not compiled (SGF_WITH_VIDEO=OFF)");
}

#endif // SGF_WITH_VIDEO (export)

} // namespace pce::video
