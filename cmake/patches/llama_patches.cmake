# cmake/patches/llama_patches.cmake
# All llama.cpp source patches in one script.
# Called via PATCH_COMMAND with -DSOURCE_DIR=<SOURCE_DIR>.
# Each sub-patch is idempotent.

set(_ctx "${SOURCE_DIR}/src/llama-context.cpp")
set(_t5  "${SOURCE_DIR}/src/models/t5.cpp")

# 1. llama-context.cpp — inject missing <algorithm> (std::fill without include)
file(READ "${_ctx}" _c)
if(NOT "${_c}" MATCHES "#include <algorithm>")
    string(REPLACE "#include <cinttypes>"
                   "#include <cinttypes>\n#include <algorithm>"
                   _c "${_c}")
    file(WRITE "${_ctx}" "${_c}")
    message(STATUS "[llama patch] injected <algorithm> in llama-context.cpp")
endif()

# 2. models/t5.cpp — forward-declare explicit constructor specializations.
#
# build_arch_graph() calls make_unique<graph<false/true>>() which triggers
# implicit instantiation of those class templates.  The explicit constructor
# specializations defined later in the same TU then violate C++ [temp.expl.spec]:
# specialization must be declared before first implicit instantiation.
#
# Fix: inject forward declarations immediately before build_arch_graph so
# Clang (and MSVC in strict mode) see them before the make_unique calls.
if(EXISTS "${_t5}")
    file(READ "${_t5}" _c)
    # Idempotent: the declaration form uses "&, " (no param name); the
    # definition form uses "& model," — they are distinct.
    string(FIND "${_c}"
           "graph<false>::graph(const llama_model &, const llm_graph_params &);"
           _already)
    if(_already EQUAL -1)
        string(REPLACE
            "std::unique_ptr<llm_graph_context> llama_model_t5::build_arch_graph"
            "template<> llama_model_t5::graph<false>::graph(const llama_model &, const llm_graph_params &);\ntemplate<> llama_model_t5::graph<true>::graph(const llama_model &, const llm_graph_params &);\n\nstd::unique_ptr<llm_graph_context> llama_model_t5::build_arch_graph"
            _c "${_c}")
        file(WRITE "${_t5}" "${_c}")
        message(STATUS "[llama patch] injected graph<> forward declarations in t5.cpp")
    endif()
endif()
