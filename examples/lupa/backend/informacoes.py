"""A ficha de um arquivo: o que o sistema de arquivos diz, e o EXIF que a foto tiver.

O EXIF é lido pelo Pillow, que o `requiredPackages` traz. Um formato que o Pillow não abre (HEIC,
SVG, PDF) fica com a parte do sistema de arquivos, e a página completa as dimensões com a imagem
que ela mesma decodificou.
"""

import os
from datetime import datetime

EXIF_IFD, GPS_IFD = 0x8769, 0x8825


def _texto(v):
    if isinstance(v, bytes):
        v = v.decode("utf-8", "replace")
    return str(v).replace("\x00", "").strip() if v is not None else ""


def _numero(v):
    try:
        return float(v)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _exposicao(v):
    s = _numero(v)
    if not s:
        return None
    return f"1/{round(1 / s)} s" if s < 1 else f"{s:g} s"


def _graus(dms, ref):
    try:
        g, m, s = (float(x) for x in dms)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    valor = g + m / 60 + s / 3600
    return round(-valor if _texto(ref) in ("S", "W") else valor, 6)


def _camera(marca, modelo):
    """`Canon EOS R6`, e não `Canon Canon EOS R6`: o modelo de muitas câmeras já traz a marca."""
    marca, modelo = _texto(marca), _texto(modelo)
    if marca and modelo.lower().startswith(marca.split()[0].lower()):
        return modelo
    return " ".join(p for p in (marca, modelo) if p)


def ficha(caminho):
    st = os.stat(caminho)
    f = {"nome": os.path.basename(caminho), "tamanho": st.st_size,
         "modificado": int(st.st_mtime * 1000)}
    try:
        from PIL import Image
    except ImportError:
        return f
    try:
        with Image.open(caminho) as im:
            largura, altura = im.size
            exif = im.getexif()
            # De lado (orientação 5 a 8), a foto aparece com a largura e a altura trocadas.
            if exif.get(274, 1) in (5, 6, 7, 8):
                largura, altura = altura, largura
            f.update(largura=largura, altura=altura, formato=im.format)
            quadros = getattr(im, "n_frames", 1)
            if quadros > 1:
                f["quadros"] = quadros
            f.update(_do_exif(exif))
    except Exception:  # noqa: BLE001  um arquivo que o Pillow não abre fica com a ficha do disco
        pass
    return f


def _do_exif(exif):
    if not exif:
        return {}
    out = {}
    camera = _camera(exif.get(271), exif.get(272))
    if camera:
        out["camera"] = camera
    e = exif.get_ifd(EXIF_IFD)
    if e.get(42036):
        out["lente"] = _texto(e[42036])
    if _exposicao(e.get(33434)):
        out["exposicao"] = _exposicao(e[33434])
    if _numero(e.get(33437)):
        out["abertura"] = f"f/{_numero(e[33437]):g}"
    iso = e.get(34855)
    if isinstance(iso, (tuple, list)):
        iso = iso[0] if iso else None
    if iso:
        out["iso"] = int(iso)
    if _numero(e.get(37386)):
        out["focal"] = f"{_numero(e[37386]):g} mm"
    data = _texto(e.get(36867) or exif.get(306))
    try:
        out["capturada"] = datetime.strptime(data, "%Y:%m:%d %H:%M:%S").isoformat()
    except ValueError:
        pass
    g = exif.get_ifd(GPS_IFD)
    if g.get(2) and g.get(4):
        lat, lon = _graus(g[2], g.get(1)), _graus(g[4], g.get(3))
        if lat is not None and lon is not None:
            out["gps"] = {"lat": lat, "lon": lon}
    return out
