#!/usr/bin/env python3
"""Gera o logo da Ambiental (monograma "A") em PNG.

Identidade visual:
  - Azul institucional: #164194 (fundo)
  - Verde lima:         #A8C950 (barra transversal / folha)
  - Branco:             #FFFFFF (monograma "A")

Saídas:
  - frontend/logo-master.png            (1024x1024 — fonte para `tauri icon`)
  - frontend/public/logo.png            (256x256)
  - frontend/public/logo-collapsed.png  (80x64)
  - frontend/public/icon_128x128.png    (128x128)
  - frontend/public/icon_32x32@2x.png   (64x64)
"""

from PIL import Image, ImageDraw, ImageFilter
import os

BLUE = "#164194"
GREEN = "#A8C950"
WHITE = "#FFFFFF"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # frontend/


def draw_logo(size: int) -> Image.Image:
    """Desenha o monograma "A" da Ambiental em um canvas quadrado."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Fundo arredondado azul institucional
    radius = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BLUE)

    # Escala relativa ao tamanho do canvas
    top_y = size * 0.22
    bottom_y = size * 0.80
    left_x = size * 0.30
    right_x = size * 0.70
    stroke = int(size * 0.115)

    # Monograma "A" branco (duas pernas)
    d.line([(size * 0.5, top_y), (left_x, bottom_y)],
           fill=WHITE, width=stroke, joint="curve")
    d.line([(size * 0.5, top_y), (right_x, bottom_y)],
           fill=WHITE, width=stroke, joint="curve")

    # Barra transversal verde lima (folha)
    bar_top = size * 0.56
    bar_bottom = size * 0.65
    bar_left = size * 0.335
    bar_right = size * 0.665
    d.rounded_rectangle(
        [bar_left, bar_top, bar_right, bar_bottom],
        radius=int(size * 0.045),
        fill=GREEN,
    )

    return img


def save_scaled(img: Image.Image, path: str, w: int, h: int) -> None:
    """Redimensiona (crop quadrado central) e salva."""
    s = max(w, h)
    square = img.resize((s, s), Image.LANCZOS)
    # crop central para proporção exata
    left = (s - w) // 2
    top = (s - h) // 2
    square.crop((left, top, left + w, top + h)).save(path, "PNG")
    print(f"  -> {os.path.relpath(path, BASE_DIR)} ({w}x{h})")


def main() -> None:
    master = draw_logo(1024)
    master_path = os.path.join(BASE_DIR, "logo-master.png")
    master.save(master_path, "PNG")
    print(f"  -> logo-master.png (1024x1024)")

    public = os.path.join(BASE_DIR, "public")
    save_scaled(master, os.path.join(public, "logo.png"), 256, 256)
    save_scaled(master, os.path.join(public, "logo-collapsed.png"), 80, 64)
    save_scaled(master, os.path.join(public, "icon_128x128.png"), 128, 128)
    save_scaled(master, os.path.join(public, "icon_32x32@2x.png"), 64, 64)

    print("\nPronto! Use o logo-master.png com: pnpm tauri icon logo-master.png")


if __name__ == "__main__":
    main()
