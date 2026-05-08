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
#  include <libswscale/swscale.h>
}
#endif

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

} // namespace pce::video
