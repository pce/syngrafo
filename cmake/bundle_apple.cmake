# cmake/bundle_apple.cmake — macOS post-build bundling for the syngrafo target.
#
# Copies dylibs/frameworks that are not part of macOS itself into the app
# bundle's Contents/Frameworks/, signs each one ad-hoc, then deep-signs the
# whole bundle last.
#
# Order matters: dylibs/frameworks must be copied and individually signed
# BEFORE the final deep-sign.  Adding images after the deep-sign step
# invalidates the bundle signature; the final deep-sign re-validates
# everything in one pass.

# ─── RPATH ────────────────────────────────────────────────────────────────────
# Set once here for all bundled dylibs.  @executable_path/../Frameworks is the
# standard macOS location for non-system dylibs inside an .app bundle.
# BUILD_WITH_INSTALL_RPATH bakes the RPATH into the binary at build time so
# dev / CI app bundles work without a separate cmake --install step.
# Harmless when Contents/Frameworks/ is empty (no bundled dylib to load).
set_target_properties(syngrafo PROPERTIES
    INSTALL_RPATH            "@executable_path/../Frameworks"
    BUILD_WITH_INSTALL_RPATH TRUE
)

# ─── ONNX Runtime ─────────────────────────────────────────────────────────────
if(NLP_WITH_ONNX)
    set(_ORT_DYLIB
        "${FETCHCONTENT_BASE_DIR}/onnxruntime-src/lib/libonnxruntime.${SGF_ORT_VERSION}.dylib")

    add_custom_command(TARGET syngrafo POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E make_directory
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${_ORT_DYLIB}"
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks/libonnxruntime.${SGF_ORT_VERSION}.dylib"
        COMMAND codesign --force --sign -
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks/libonnxruntime.${SGF_ORT_VERSION}.dylib"
        COMMENT "[syngrafo] Bundling + ad-hoc signing libonnxruntime"
        VERBATIM
    )
    unset(_ORT_DYLIB)
endif()

# ─── CSound framework ────────────────────────────────────────────────────────
# Three problems to solve when bundling a macOS framework:
#
# 1. cmake -E copy_directory does NOT preserve symlinks → broken framework
#    structure → codesign fails: "bundle format is ambiguous".
#    Fix: use ditto (macOS-native, preserves symlinks + resource forks).
#
# 2. codesign on a .framework directory fails if it can't determine bundle type.
#    Fix: sign the actual dylib binary inside the framework, not the directory.
#    The final --deep sign covers the framework wrapper.
#
# 3. CSound 7 ships with an absolute install name:
#      /Applications/Csound/CsoundLib64.framework/CsoundLib64
#    dyld can't find that path inside our bundle.
#    Fix: use install_name_tool to rewrite both the framework's own -id and the
#    reference baked into the syngrafo binary.
#    SGF_CSOUND_INSTALL_NAME holds the original absolute path (set by audio.cmake
#    via otool -D at configure time, or hardcoded for the fetch path).
if(SGF_WITH_AUDIO AND AUDIO_CSOUND_FOUND
        AND DEFINED SGF_CSOUND_FRAMEWORK_DIR AND SGF_CSOUND_FRAMEWORK_DIR)

    get_filename_component(_csound_fw_name "${SGF_CSOUND_FRAMEWORK_DIR}" NAME)
    # Strip .framework suffix to get the binary name inside (e.g. CsoundLib64)
    string(REPLACE ".framework" "" _csound_fw_bin_name "${_csound_fw_name}")

    # Determine the original install name so install_name_tool -change can
    # rewrite the reference in the syngrafo binary.
    # Falls back to the CSound 7 default if not set by audio.cmake.
    if(NOT DEFINED SGF_CSOUND_INSTALL_NAME OR NOT SGF_CSOUND_INSTALL_NAME)
        set(_csound_orig_id "/Applications/Csound/${_csound_fw_name}/${_csound_fw_bin_name}")
    else()
        set(_csound_orig_id "${SGF_CSOUND_INSTALL_NAME}")
    endif()

    set(_csound_rpath_id "@rpath/${_csound_fw_name}/${_csound_fw_bin_name}")

    add_custom_command(TARGET syngrafo POST_BUILD
        # 1. Ensure Frameworks directory exists
        COMMAND ${CMAKE_COMMAND} -E make_directory
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks"

        # 1b. Remove any stale copy from a previous build — ditto merges by default
        #     and will collide if old cmake -E copy_directory left real dirs where
        #     symlinks should be.
        COMMAND ${CMAKE_COMMAND} -E remove_directory
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks/${_csound_fw_name}"

        # 2. ditto preserves macOS symlinks + resource forks
        #    (cmake -E copy_directory does not → codesign "bundle format is ambiguous")
        COMMAND ditto
            "${SGF_CSOUND_FRAMEWORK_DIR}"
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks/${_csound_fw_name}"

        # 2b. Remove the opcode plugin directory (libs/) that CSound ships at the
        #     framework root.  It is non-standard (not covered by the framework seal)
        #     and causes codesign --deep to fail with "unsealed contents present".
        #     We only need the core dylib for offline WAV rendering.
        COMMAND ${CMAKE_COMMAND} -E remove_directory
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks/${_csound_fw_name}/libs"

        # 3. Fix the framework's own install name (-id) to use @rpath
        COMMAND install_name_tool -id
            "${_csound_rpath_id}"
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks/${_csound_fw_name}/${_csound_fw_bin_name}"

        # 4. Rewrite the syngrafo binary's reference from the old absolute path
        #    to the new @rpath-relative one
        COMMAND install_name_tool -change
            "${_csound_orig_id}"
            "${_csound_rpath_id}"
            "$<TARGET_FILE:syngrafo>"

        # 5. Sign just the framework binary (signing the directory causes
        #    "bundle format is ambiguous" on frameworks without Info.plist)
        COMMAND codesign --force --sign -
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks/${_csound_fw_name}/${_csound_fw_bin_name}"

        COMMENT "[syngrafo] Bundling + patching install name + signing ${_csound_fw_name}"
        VERBATIM
    )

    unset(_csound_fw_name)
    unset(_csound_fw_bin_name)
    unset(_csound_orig_id)
    unset(_csound_rpath_id)
endif()

# ─── NLP models / data ────────────────────────────────────────────────────────
add_custom_command(TARGET syngrafo POST_BUILD
    COMMAND ${CMAKE_COMMAND}
        -DSRC_DIR=${CMAKE_CURRENT_SOURCE_DIR}/data
        -DDST_DIR=$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Resources/data
        -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/bundle_data_if_exists.cmake
    COMMENT "[syngrafo] Bundling data/ → .app/Contents/Resources/data/"
    VERBATIM
)

# ─── SQLCipher dylib ──────────────────────────────────────────────────────────
# Only needed when using a system dylib (e.g. Homebrew sqlcipher).
# When using the sqlite3mc FetchContent fallback the library is static — nothing
# to copy or sign.
if(SQLCIPHER_FOUND AND SQLCIPHER_LIBRARIES)
    execute_process(
        COMMAND otool -D "${SQLCIPHER_LIBRARIES}"
        OUTPUT_VARIABLE _sc_otool_out
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
    )
    string(REGEX REPLACE ".*[\r\n]([^\r\n]+)$" "\\1" _sc_install_name "${_sc_otool_out}")
    string(STRIP "${_sc_install_name}" _sc_install_name)
    get_filename_component(_sc_dylib_name     "${_sc_install_name}"    NAME)
    get_filename_component(_sc_dylib_realpath "${SQLCIPHER_LIBRARIES}" REALPATH)

    message(STATUS "[syngrafo] SQLCipher install name : ${_sc_install_name}")
    message(STATUS "[syngrafo] SQLCipher real path    : ${_sc_dylib_realpath}")

    add_custom_command(TARGET syngrafo POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E make_directory
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${_sc_dylib_realpath}"
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks/${_sc_dylib_name}"
        COMMAND install_name_tool -change
            "${_sc_install_name}"
            "@rpath/${_sc_dylib_name}"
            "$<TARGET_FILE:syngrafo>"
        COMMAND codesign --force --sign -
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks/${_sc_dylib_name}"
        COMMENT "[syngrafo] Bundling + ad-hoc signing ${_sc_dylib_name}"
        VERBATIM
    )

    unset(_sc_otool_out)
    unset(_sc_install_name)
    unset(_sc_dylib_name)
    unset(_sc_dylib_realpath)
endif()

# Ad-hoc deep-sign
# dyld on macOS 12+ sends SIGKILL (not catchable, no output) when any loaded
# image is unsigned or has a team-ID mismatch.  An ad-hoc deep-sign satisfies
# dyld for CI/dev builds without requiring an Apple Developer identity.
add_custom_command(TARGET syngrafo POST_BUILD
    COMMAND codesign --force --deep --sign - "$<TARGET_BUNDLE_DIR:syngrafo>"
    COMMENT "[syngrafo] Ad-hoc deep-signing bundle"
    VERBATIM
)
