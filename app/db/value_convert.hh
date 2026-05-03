/**
 * @file value_convert.hh
 * @brief C++ → DbValueView conversion for zero-copy query binding.
 */
#ifndef PCE_DB_VALUE_CONVERT_HH
#define PCE_DB_VALUE_CONVERT_HH

#include "value.hh"
#include "concepts.hh"

namespace pce::db {

    template <DbBindable T>
    [[nodiscard]] DbValueView to_db_value_view(T&& v) {
        using D = std::decay_t<T>;

        if constexpr (std::is_same_v<D, std::nullptr_t>)
            return std::monostate{};

        else if constexpr (std::is_integral_v<D>)
            return static_cast<int64_t>(v);

        else if constexpr (std::is_floating_point_v<D>)
            return static_cast<double>(v);

        else if constexpr (std::is_same_v<D, std::string>)
            return std::string_view{v};

        else if constexpr (std::is_same_v<D, std::string_view>)
            return v;

        else if constexpr (requires { std::data(v); std::size(v); })
            return std::span<const uint8_t>{
                reinterpret_cast<const uint8_t*>(std::data(v)),
                std::size(v)
            };

        else
            static_assert(!sizeof(D), "Unsupported bind type");
    }

}

#endif // PCE_DB_VALUE_CONVERT_HH
