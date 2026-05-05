/**
 * @file platform_services_linux.cpp
 * @brief Linux native file-manager reveal via D-Bus.
 *
 * Implements @c pce::nlp::platform for Linux/Unix targets.
 * @c reveal_in_file_manager calls @c org.freedesktop.FileManager1.ShowItems,
 * which is supported by Nautilus, Dolphin, Thunar, Nemo, and most desktop
 * file managers.  Requires @c dbus-1 at build time (@c HAVE_DBUS defined by CMake);
 * degrades to a no-op in headless / CI environments where D-Bus is absent.
 *
 * All other @c platform functions (Apple-only features) are no-ops.
 */

#include "platform_services.hh"
#include <string>

#ifdef HAVE_DBUS
#  include <dbus/dbus.h>
#endif

namespace pce::nlp::platform {

std::vector<Point2D> detect_document_corners(const std::string&) { return {}; }
bool rectify_image(const std::string&, const std::string&, const std::vector<Point2D>&) { return false; }
std::string extract_exif(const std::string&) { return "{}"; }

bool reveal_in_file_manager(const std::string& path) {
#ifdef HAVE_DBUS
    const std::string uri = "file://" + path;

    DBusError err;
    dbus_error_init(&err);

    DBusConnection* conn = dbus_bus_get(DBUS_BUS_SESSION, &err);
    if (dbus_error_is_set(&err) || !conn) {
        dbus_error_free(&err);
        return false;
    }

    // D-Bus method: org.freedesktop.FileManager1.ShowItems(as uris, s startup_id)
    DBusMessage* msg = dbus_message_new_method_call(
        "org.freedesktop.FileManager1",
        "/org/freedesktop/FileManager1",
        "org.freedesktop.FileManager1",
        "ShowItems");
    if (!msg) return false;

    DBusMessageIter iter, arr;
    dbus_message_iter_init_append(msg, &iter);

    dbus_message_iter_open_container(&iter, DBUS_TYPE_ARRAY, DBUS_TYPE_STRING_AS_STRING, &arr);
    const char* uri_cstr = uri.c_str();
    dbus_message_iter_append_basic(&arr, DBUS_TYPE_STRING, &uri_cstr);
    dbus_message_iter_close_container(&iter, &arr);

    const char* startup_id = "";
    dbus_message_iter_append_basic(&iter, DBUS_TYPE_STRING, &startup_id);

    DBusMessage* reply = dbus_connection_send_with_reply_and_block(conn, msg, 2000, &err);
    dbus_message_unref(msg);

    const bool ok = !dbus_error_is_set(&err) && reply != nullptr;
    if (reply) dbus_message_unref(reply);
    dbus_error_free(&err);
    return ok;
#else
    (void)path;
    return false;
#endif
}

} // namespace pce::nlp::platform

// OCR backend stubs — active when neither NLP_APPLE_VISION nor NLP_WITH_TESSERACT is defined.
#if !defined(NLP_APPLE_VISION) && !defined(NLP_WITH_TESSERACT)
namespace pce::nlp::backend {
std::string extract_text(const std::string&) { return ""; }
std::string extract_text_from_pdf(const std::string& p) { return extract_text(p); }
} // namespace pce::nlp::backend
#endif
