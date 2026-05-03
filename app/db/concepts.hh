/**
 * @file concepts.hh
 * @brief DbBindable concept — types accepted as query binding parameters.
 */
#ifndef PCE_DB_CONCEPTS_HH
#define PCE_DB_CONCEPTS_HH
#include <concepts>
#include <string_view>
#include <span>

namespace pce::db {

    template<typename T>
    concept DbBindable =
        std::same_as<std::decay_t<T>, std::nullptr_t> ||
        std::integral<std::decay_t<T>> ||
        std::floating_point<std::decay_t<T>> ||
        std::same_as<std::decay_t<T>, std::string> ||
        std::same_as<std::decay_t<T>, std::string_view> ||
        requires(T v) {
            { std::data(v) };
            { std::size(v) };
        };

}
#endif //PCE_DB_CONCEPTS_HH
