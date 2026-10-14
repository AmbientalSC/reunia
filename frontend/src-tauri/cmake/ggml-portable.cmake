# Baseline portátil (x86-64-v3: AVX2/FMA/F16C/BMI2) para whisper.cpp / ggml.
#
# Sem isto o ggml usa GGML_NATIVE=ON. No MSVC, o FindSIMD.cmake testa a CPU da MÁQUINA DE
# BUILD (no CI do GitHub, com AVX-512) e compila tudo com /arch:AVX512, derrubando o app com
# ILLEGAL_INSTRUCTION (0xC000001D) em qualquer PC sem AVX-512 (visto na v0.4.6).
#
# Carregado via CMAKE_PROJECT_INCLUDE (definido em .cargo/config.toml): o build.rs do
# whisper-rs-sys repassa as variáveis CMAKE_* ao cmake e este arquivo roda após cada project().
# Manter em sincronia com src/cpu_support.rs, que recusa os motores locais em CPUs abaixo disso.
if (CMAKE_SYSTEM_PROCESSOR MATCHES "^(x86_64|AMD64|amd64|x64|X64)$")
    set(GGML_NATIVE      OFF CACHE BOOL "ggml: build portátil, sem detecção da CPU de build" FORCE)
    set(GGML_AVX         ON  CACHE BOOL "ggml: AVX"          FORCE)
    set(GGML_AVX2        ON  CACHE BOOL "ggml: AVX2"         FORCE)
    set(GGML_FMA         ON  CACHE BOOL "ggml: FMA"          FORCE)
    set(GGML_F16C        ON  CACHE BOOL "ggml: F16C"         FORCE)
    set(GGML_AVX512      OFF CACHE BOOL "ggml: AVX512"       FORCE)
    set(GGML_AVX512_VBMI OFF CACHE BOOL "ggml: AVX512-VBMI"  FORCE)
    set(GGML_AVX512_VNNI OFF CACHE BOOL "ggml: AVX512-VNNI"  FORCE)
    set(GGML_AVX512_BF16 OFF CACHE BOOL "ggml: AVX512-BF16"  FORCE)
    set(GGML_AMX_TILE    OFF CACHE BOOL "ggml: AMX-TILE"     FORCE)
    set(GGML_AMX_INT8    OFF CACHE BOOL "ggml: AMX-INT8"     FORCE)
    set(GGML_AMX_BF16    OFF CACHE BOOL "ggml: AMX-BF16"     FORCE)
endif()
