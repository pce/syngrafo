#pragma once
/**
 * @file bindings/archive_bindings.hh
 * @author Patrick Engel
 * @brief Archive/compression domain bindings:
 *        create_archive, compress_file.
 *
 * Delegates to system tools (zip, tar, gzip, bzip2, zstd).
 */

#pragma once
#include "../dms_handle.hh"

namespace pce::dms {

inline void register_archive_bindings(saucer::smartview& wv, DMSHandle& /*dms*/,
                                       saucer::modules::desktop& /*desk*/) {
    using std::string;

    // dms_create_archive
    // dms_create_archive(sources_json, destPath, format) → { path, sizeBytes }
    // format: "zip" | "tar.gz" | "tar.bz2" | "tar.zst"
    wv.expose("dms_create_archive",
              [](string sources_json, string dest_path, string format) -> string {
        std::vector<std::string> sources;
        try { for(auto& s:json::parse(sources_json)) sources.push_back(s.get<std::string>()); }
        catch (...) { return DMSHandle::err_str("Invalid sources JSON"); }
        if (sources.empty()) return DMSHandle::err_str("No sources provided");

        std::string file_list;
        for (const auto& s : sources) file_list += '"' + s + "\" ";

        std::string cmd;
        if      (format=="zip")     cmd=std::format("zip -r \"{}\" {} >/dev/null 2>&1",dest_path,file_list);
        else if (format=="tar.gz")  cmd=std::format("tar -czf \"{}\" {} 2>&1",          dest_path,file_list);
        else if (format=="tar.bz2") cmd=std::format("tar -cjf \"{}\" {} 2>&1",          dest_path,file_list);
        else if (format=="tar.zst") cmd=std::format("tar --use-compress-program=zstd -cf \"{}\" {} 2>&1",
                                                     dest_path,file_list);
        else return DMSHandle::err_str(std::format("Unknown archive format: {}", format));

        if (int rc=std::system(cmd.c_str()); rc!=0)
            return DMSHandle::err_str(std::format("Archive command failed (exit {})", rc));

        std::error_code ec;
        const int64_t sz=(int64_t)fs::file_size(fs::path{dest_path},ec);
        return DMSHandle::ok_str(json{{"path",dest_path},{"sizeBytes",ec?int64_t{0}:sz}});
    });

    // dms_compress_file
    // dms_compress_file(srcPath, destPath, format, level) → { path, sizeBytes, ratio }
    // format: "gz" | "bz2" | "zst"
    wv.expose("dms_compress_file",
              [](string src_path, string dest_path, string format, int level) -> string {
        if (!fs::exists(fs::path{src_path}))
            return DMSHandle::err_str(std::format("'{}' not found", src_path));
        level=std::clamp(level,1,9);
        std::string cmd;
        if      (format=="gz")  cmd=std::format("gzip -{} -k -c \"{}\" > \"{}\" 2>&1",  level,src_path,dest_path);
        else if (format=="bz2") cmd=std::format("bzip2 -{} -k -c \"{}\" > \"{}\" 2>&1", level,src_path,dest_path);
        else if (format=="zst") cmd=std::format("zstd -{} \"{}\" -o \"{}\" 2>&1",        level,src_path,dest_path);
        else return DMSHandle::err_str(std::format("Unknown compression format: {}", format));
        if (int rc=std::system(cmd.c_str()); rc!=0)
            return DMSHandle::err_str(std::format("Compression failed (exit {})", rc));
        std::error_code ec;
        const int64_t orig=(int64_t)fs::file_size(fs::path{src_path},ec);
        const int64_t comp=(int64_t)fs::file_size(fs::path{dest_path},ec);
        const double ratio=orig>0?(1.0-(double)comp/orig):0.0;
        return DMSHandle::ok_str(json{{"path",dest_path},{"sizeBytes",comp},{"ratio",ratio}});
    });
}

} // namespace pce::dms

