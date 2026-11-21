"""Small source launcher for the optional loopback Python accelerator."""
from pathlib import Path
import shutil
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
def sources():
    for directory in ('waterwave', 'src/water-wave'):
        for path in sorted((root/directory).rglob('*')):
            if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
                yield path, path.relative_to(root).as_posix()
    for name in ('launch-water-wave.bat', 'launch-water-wave.command', 'requirements-waterwave.txt', 'requirements-waterwave-gpu.txt', 'scripts/setup-native-gpu.py', 'LICENSE'):
        yield root/name, name
    yield root/'docs/native-accelerator.md', 'README.md'

args = sys.argv[1:]
if args[:1] == ['--directory'] and len(args) == 2:
    destination = Path(args[1]); destination.mkdir(parents=True, exist_ok=False)
    for source, name in sources():
        target = destination/name; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
elif len(args) <= 1:
    destination = Path(args[0]) if args else root/'dist/water-wave/native-accelerator.zip'
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for source, name in sources(): archive.write(source, name)
else:
    raise SystemExit('native-bundle.py [ZIP | --directory DIR]')
print(destination)
