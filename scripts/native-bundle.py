"""Small source launcher for the optional loopback Python accelerator."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
destination = root/'dist/water-wave/native-accelerator.zip'
destination.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for directory in ('waterwave', 'src/water-wave'):
        for path in sorted((root/directory).rglob('*')):
            if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
                archive.write(path, path.relative_to(root).as_posix())
    for name in ('launch-water-wave.bat', 'launch-water-wave.command', 'requirements-waterwave.txt', 'requirements-waterwave-gpu.txt', 'scripts/setup-native-gpu.py', 'LICENSE'):
        archive.write(root/name, name)
    archive.write(root/'docs/native-accelerator.md', 'README.md')
print(destination)
