"""ZIP with portable executable permissions (no installation required)."""
import pathlib
import sys
import zipfile

root = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for path in sorted(root.rglob('*')):
        if not path.is_file():
            continue
        info = zipfile.ZipInfo(path.relative_to(root).as_posix())
        info.create_system = 3
        mode = 0o755 if path.name in ('waterwave', 'start.command') else 0o644
        info.external_attr = (0o100000 | mode) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, path.read_bytes())
