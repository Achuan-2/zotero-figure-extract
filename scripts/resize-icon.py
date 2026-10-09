"""从已生成的透明 PNG 原图导出插件所需尺寸，仅执行等比缩小。"""

from pathlib import Path

from PIL import Image


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    output = root / "addon" / "chrome" / "content" / "icons"
    output.mkdir(parents=True, exist_ok=True)
    with Image.open(root / "assets" / "icon.png") as original:
        original = original.convert("RGBA")
        if original.width != original.height:
            raise ValueError("图标原图必须为正方形")
        if original.getpixel((0, 0))[3] != 0:
            raise ValueError("图标外角必须具有透明背景")
        print(f"原图：{original.size}，透明外角已确认")
        for size in (48, 96, 128):
            target = output / f"icon-{size}.png"
            original.resize((size, size), Image.Resampling.LANCZOS).save(target)
            print(target)


if __name__ == "__main__":
    main()
