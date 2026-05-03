# cmake/bundle_apple.cmake — macOS post-build bundling for the syngrafo target.
#
# Bundles into syngrafo.app/Contents/:
#   Frameworks/libonnxruntime.1.17.3.dylib   (when ONNX is enabled)
#   Frameworks/<sqlcipher-dylib>             (when SQLCipher is found)
#   Resources/data/                          (NLP models, vocab, etc.)
#
# The ONNX and SQLCipher blocks also set BUILD_WITH_INSTALL_RPATH so dyld
# resolves bundled dylibs at runtime regardless of install location.
#
# This file is only included on Apple platforms.

# ONNX Runtime ──────────────────────────────────────────────────────────────
if(NOT DISABLE_ONNX)
    set(_ORT_DYLIB
        "${FETCHCONTENT_BASE_DIR}/onnxruntime-src/lib/libonnxruntime.1.17.3.dylib")

    set_target_properties(syngrafo PROPERTIES
        INSTALL_RPATH            "@executable_path/../Frameworks"
        BUILD_WITH_INSTALL_RPATH TRUE
    )

    add_custom_command(TARGET syngrafo POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E make_directory
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${_ORT_DYLIB}"
            "$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Frameworks/libonnxruntime.1.17.3.dylib"
        COMMENT "[syngrafo] Bundling libonnxruntime → .app/Contents/Frameworks/"
        VERBATIM
    )

    unset(_ORT_DYLIB)
endif()

# NLP models / data
add_custom_command(TARGET syngrafo POST_BUILD
    COMMAND ${CMAKE_COMMAND}
        -DSRC_DIR=${CMAKE_CURRENT_SOURCE_DIR}/data
        -DDST_DIR=$<TARGET_BUNDLE_DIR:syngrafo>/Contents/Resources/data
        -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/bundle_data_if_exists.cmake
    COMMENT "[syngrafo] Bundling data/ → .app/Contents/Resources/data/"
    VERBATIM
)

# SQLCipher dylib
if(SQLCIPHER_FOUND)
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

    set_target_properties(syngrafo PROPERTIES
        INSTALL_RPATH            "@executable_path/../Frameworks"
        BUILD_WITH_INSTALL_RPATH TRUE
    )

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
        COMMENT "[syngrafo] Bundling ${_sc_dylib_name} → .app/Contents/Frameworks/"
        VERBATIM
    )

    unset(_sc_otool_out)
    unset(_sc_install_name)
    unset(_sc_dylib_name)
    unset(_sc_dylib_realpath)
endif()

