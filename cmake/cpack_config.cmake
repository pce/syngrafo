# cmake/cpack_config.cmake — CPack installer / package configuration.
#
# Generates platform-native packages after `cmake --build`:
#   macOS   → Syngrafo-<ver>-Darwin.dmg           (DragNDrop DMG)
#   Linux   → Syngrafo-<ver>-Linux.deb            (Debian package)
#             Syngrafo-<ver>-Linux.tar.gz          (portable tarball)
#   Windows → Syngrafo-<ver>-Windows.msi          (WiX MSI installer)
#             Syngrafo-<ver>-Windows.zip           (portable ZIP)
#
# Usage (from the build directory):
#   cpack -C Release

set(CPACK_PACKAGE_NAME                "Syngrafo")
set(CPACK_PACKAGE_VENDOR              "pce")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "Local-first document management with NLP and 3D preview")
set(CPACK_PACKAGE_VERSION             "${PROJECT_VERSION}")
set(CPACK_PACKAGE_HOMEPAGE_URL        "https://github.com/pce/syngrafo")
set(CPACK_PACKAGE_INSTALL_DIRECTORY   "Syngrafo")
# Strip release packages; preserve debug symbols in Debug builds.
if(NOT CMAKE_BUILD_TYPE STREQUAL "Debug")
    set(CPACK_STRIP_FILES TRUE)
endif()

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/LICENSE")
    set(CPACK_RESOURCE_FILE_LICENSE "${CMAKE_CURRENT_SOURCE_DIR}/LICENSE")
endif()

# ── macOS ─────────────────────────────────────────────────────────────────────
if(APPLE)
    install(TARGETS syngrafo BUNDLE DESTINATION .)

    set(CPACK_GENERATOR       "DragNDrop")
    set(CPACK_DMG_FORMAT      "UDBZ")           # bzip2-compressed DMG
    set(CPACK_DMG_VOLUME_NAME "Syngrafo ${PROJECT_VERSION}")

# ── Linux ─────────────────────────────────────────────────────────────────────
elseif(UNIX)
    include(GNUInstallDirs)
    install(TARGETS syngrafo RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})

    # Bundle the data/ directory (NLP models, catalog, tessdata) next to the binary
    # at runtime: the app looks for <exe_dir>/data/ first (see data_dir() in main.cc).
    if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/data")
        install(DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/data/"
                DESTINATION "${CMAKE_INSTALL_BINDIR}/data"
                FILES_MATCHING PATTERN "*"
                PATTERN "*.db"  EXCLUDE   # don't ship development databases
                PATTERN "*.db-shm" EXCLUDE
                PATTERN "*.db-wal" EXCLUDE
                PATTERN "inp/" EXCLUDE    # don't ship dev input files
        )
    endif()

    set(CPACK_GENERATOR "DEB;TGZ")
    set(CPACK_DEBIAN_PACKAGE_MAINTAINER     "pce")
    set(CPACK_DEBIAN_PACKAGE_SECTION        "utils")
    set(CPACK_DEBIAN_PACKAGE_ARCHITECTURE   "amd64")
    # Runtime dependencies for Ubuntu 24.04 (Noble) + LLVM 20 runtime.
    set(CPACK_DEBIAN_PACKAGE_DEPENDS
        "libwebkitgtk-6.0-4, libgtk-4-1, libadwaita-1-0, libsqlite3-0, libc++1-20, libc++abi1-20")

# ── Windows ───────────────────────────────────────────────────────────────────
elseif(WIN32)
    install(TARGETS syngrafo RUNTIME DESTINATION .)

    # data/ next to the .exe — same sibling logic as Linux
    if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/data")
        install(DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/data/"
                DESTINATION "data"
                FILES_MATCHING PATTERN "*"
                PATTERN "*.db"     EXCLUDE
                PATTERN "*.db-shm" EXCLUDE
                PATTERN "*.db-wal" EXCLUDE
                PATTERN "inp/"     EXCLUDE
        )
    endif()

    set(CPACK_GENERATOR "WIX;ZIP")
    # WiX Toolset v3 is pre-installed on windows-2025 GitHub Actions runners.
    # A GUID is required by WiX as a stable upgrade code — do NOT change it
    # between releases or Windows Add/Remove Programs will treat each version
    # as a different product instead of upgrading the existing installation.
    set(CPACK_WIX_UPGRADE_GUID       "4738B306-08AF-4519-961B-E16ED2303EB7")
    set(CPACK_WIX_PRODUCT_NAME        "Syngrafo")
    set(CPACK_WIX_PROGRAM_MENU_FOLDER "Syngrafo")
endif()

include(CPack)
