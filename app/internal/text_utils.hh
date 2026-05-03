#pragma once
/**
 * @file internal/text_utils.hh
 * @brief Plain-text and SVG text extraction utilities.
 *
 * @note Application-internal. Do not include from external headers.
 */

#include <algorithm>
#include <string>
#include <string_view>

namespace pce::dms {

/** Strip HTML/XML tags and decode common HTML entities. */
[[nodiscard]] inline std::string strip_html_tags(const std::string& html) {
    std::string result;
    result.reserve(html.size());
    bool in_tag = false;
    for (char c : html) {
        if      (c == '<') { in_tag = true;  result += ' '; }
        else if (c == '>') { in_tag = false; }
        else if (!in_tag)  { result += c; }
    }
    const std::pair<std::string_view, char> ents[] = {
        {"&amp;",'&'},{"&lt;",'<'},{"&gt;",'>'},{"&quot;",'"'},
        {"&apos;","'"[0]},{"&nbsp;",' '}
    };
    for (auto& [seq, ch] : ents) {
        std::string out; out.reserve(result.size());
        std::string_view sv{result}; size_t pos=0, found;
        while ((found=sv.find(seq,pos))!=std::string_view::npos) {
            out.append(sv,pos,found-pos); out+=ch; pos=found+seq.size();
        }
        out.append(sv,pos); result=std::move(out);
    }
    std::string compact; compact.reserve(result.size()); bool prev=true;
    for (char c : result) {
        if (std::isspace((unsigned char)c)) { if (!prev){compact+=' ';prev=true;} }
        else { compact+=c; prev=false; }
    }
    return compact;
}

/** Extract user-visible text from SVG @c <text>, @c <tspan>, @c <title>, and @c <desc> elements. */
[[nodiscard]] inline std::string extract_svg_text(const std::string& svg) {
    std::string result;
    static const std::string_view tags[]{"text","tspan","title","desc"};
    for (std::string_view tag : tags) {
        const std::string op = "<" + std::string{tag};
        const std::string cl = "</" + std::string{tag} + ">";
        size_t pos=0, found;
        while ((found=svg.find(op,pos))!=std::string::npos) {
            const size_t te=svg.find('>',found); if(te==std::string::npos) break;
            const size_t cs=te+1, cp=svg.find(cl,cs); if(cp==std::string::npos) break;
            const std::string stripped=strip_html_tags(svg.substr(cs,cp-cs));
            if (!stripped.empty() && !std::all_of(stripped.begin(),stripped.end(),
                [](char c){return std::isspace((unsigned char)c);}))
                result += stripped + ' ';
            pos=cp+cl.size();
        }
    }
    return result.empty() ? "(no text content)" : result;
}

} // namespace pce::dms

