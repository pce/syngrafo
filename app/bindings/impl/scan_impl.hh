#pragma once
#include "../../dms_handle.hh"

namespace pce::dms {

inline Expected<json> DMSHandle::scan_dir(std::string_view path_str, bool recursive) {
    std::string actual{path_str};
    if (actual=="global"||actual=="input"||actual.empty())
        actual=get_active_in_path();
    const fs::path root{actual};
    return require(fs::exists(root), std::format("'{}' does not exist", actual))
        .and_then([&]()->VoidResult{
            return require(fs::is_directory(root),
                           std::format("'{}' is not a directory", path_str));
        })
        .and_then([&]()->Expected<json>{
            return try_invoke([&]()->json{
                json items=json::array(); std::error_code ec;
                auto collect=[&](const fs::directory_entry& e){
                    std::error_code e2;
                    const bool is_dir=e.is_directory(e2);
                    const int64_t fsize=is_dir?0:(int64_t)e.file_size(e2);
                    const auto ext=e.path().extension().string();
                    const auto mime=is_dir?"inode/directory":mime_for_extension(ext);
                    bool indexed=false;
                    if (!is_dir){
                        std::lock_guard lk{db_mutex};
                        indexed=active_db().from("dms_documents")
                                    .where("path = ?",e.path().string()).exists();
                    }
                    items.push_back({{"name",e.path().filename().string()},
                        {"path",e.path().string()},{"is_dir",is_dir},
                        {"size",fsize},{"mtime",file_mtime_unix(e.path())},
                        {"mime_type",mime},{"indexed",indexed}});
                };
                const auto skip=fs::directory_options::skip_permission_denied;
                if (recursive)
                    for(const auto& e:fs::recursive_directory_iterator(root,skip,ec)) collect(e);
                else
                    for(const auto& e:fs::directory_iterator(root,skip,ec)) collect(e);
                std::sort(items.begin(),items.end(),[](const json& a,const json& b){
                    const bool da=a.value("is_dir",false),db_=b.value("is_dir",false);
                    if(da!=db_) return (int)da>(int)db_;
                    return a.value("name",std::string{})<b.value("name",std::string{});
                });
                return json{{"path",root.string()},{"items",std::move(items)}};
            });
        });
}

inline Expected<json> DMSHandle::read_file(std::string_view path_str) {
    const fs::path p{path_str}; std::error_code ec;
    if (!fs::exists(p,ec)){
        // content_blob is no longer written by the indexer (blob storage is
        // deferred), so this branch is dead for new documents.  It is kept
        // here only for databases that were indexed before the change, where
        // the column may still contain data.
        std::lock_guard lk{db_mutex};
        auto row=active_db().from("dms_documents")
                     .where("path = ?",std::string{path_str}).first();
        if (row && !row->is_null("content_blob")){
            const auto mime=row->get<std::string>("mime_type");
            const auto blob=row->get<std::vector<uint8_t>>("content_blob");
            if (!is_indexable_text(mime))
                return json{{"path",std::string{path_str}},
                    {"filename",row->get<std::string>("filename")},
                    {"mime_type",mime},{"size",(int64_t)blob.size()},
                    {"mtime",row->get<int64_t>("mtime")},{"content",nullptr},
                    {"line_count",0},{"truncated",false},{"binary",true},{"from_db",true}};
            std::string content(blob.begin(),blob.end());
            const int lines=(int)(std::ranges::count(content,'\n')+(content.empty()?0:1));
            return json{{"path",std::string{path_str}},
                {"filename",row->get<std::string>("filename")},
                {"mime_type",mime},{"size",(int64_t)blob.size()},
                {"mtime",row->get<int64_t>("mtime")},{"content",std::move(content)},
                {"line_count",lines},{"truncated",false},{"binary",false},{"from_db",true}};
        }
        return std::unexpected(std::format("'{}' does not exist on disk or in DB",path_str));
    }
    return require(!fs::is_directory(p,ec),
                   std::format("'{}' is a directory",path_str))
        .and_then([&]()->Expected<json>{
            const int64_t fsize=(int64_t)fs::file_size(p,ec);
            const auto mime=mime_for_extension(p.extension().string());
            if (!is_indexable_text(mime))
                return json{{"path",p.string()},{"filename",p.filename().string()},
                    {"mime_type",mime},{"size",fsize},{"mtime",file_mtime_unix(p)},
                    {"content",nullptr},{"line_count",0},{"truncated",false},{"binary",true}};
            static constexpr size_t kMax=10u*1024u*1024u;
            const bool trunc=(size_t)fsize>kMax;
            return safe_read_text(p,kMax).transform([&](std::string content)->json{
                const int lines=(int)(std::ranges::count(content,'\n')+(content.empty()?0:1));
                return json{{"path",p.string()},{"filename",p.filename().string()},
                    {"mime_type",mime},{"size",fsize},{"mtime",file_mtime_unix(p)},
                    {"content",std::move(content)},{"line_count",lines},
                    {"truncated",trunc},{"binary",false}};
            });
        });
}

} // namespace pce::dms
