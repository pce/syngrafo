file(READ "${FILE}" _c)
string(REPLACE "->opaddr" "->opadr" _c "${_c}")
file(WRITE "${FILE}" "${_c}")
