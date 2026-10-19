<img width="1503" height="2268" alt="image" src="https://github.com/user-attachments/assets/8c7c13da-13de-4ef6-a2b1-e8c5c104c1b8" />


An internet connection is required during the first installation to download Electron and optional FFmpeg dependencies.

Getting Started
Install Dependencies
PowerShell:

npm.cmd install
Command Prompt (cmd):

npm install
Launch the Application
PowerShell:

npm.cmd start
Command Prompt:

npm start
Building Installers
Generate platform installers:

npm.cmd run build
Generated files can be found in the dist folder.

Supported formats:

Windows (.exe)
macOS (.dmg)
Linux (.AppImage)
Playback Modes
Automatic Mode
Media is displayed in random order.
Display duration is configurable.
Videos automatically advance when playback ends.
Press Space to pause or resume.
Click-by-Click Mode
Left Click = Next media
Right Click = Previous media
Space = Next media
Right Arrow = Next media
Left Arrow = Previous media
No Repeated Media
Every photo or video is shown only once.
Viewing history is automatically saved between sessions.
When all media has been displayed, an "Everything has been viewed" screen appears.
Exact duplicates are automatically ignored, even if they exist under different names or locations.
Use the "Reset History" button to start over.
Supported Formats
Native Image Formats
JPG
PNG
GIF
WebP
AVIF
BMP
SVG
ICO
Automatically Converted Image Formats
Converted to JPEG on demand:

HEIC / HEIF (iPhone)
TIFF
JPEG 2000
TGA
PPM
PCX
Native Video Formats
MP4
M4V
WebM
OGV
MOV
Automatically Converted Video Formats
Using FFmpeg:

MKV
AVI
WMV
FLV
MPEG
3GP
TS
MTS
M2TS
VOB
ASF
Many additional formats
Unsupported codecs such as HEVC are automatically re-encoded to H.264 when possible.

VLC Fallback
A "VLC" button allows opening any media file directly in VLC if it is installed on the system.

Not Supported
RAW camera formats are currently unsupported:

CR2
NEF
ARW
DNG
and similar formats
Media Sources
Media can be imported from:

Local folders
ZIP archives (Google Takeout, backups, etc.)
Public iCloud Shared Albums
Google Drive synchronized folders
OneDrive synchronized folders
iCloud for Windows synchronized folders
FFmpeg Information
If you encounter:

ffmpeg-static install failed: No binary found for architecture
This is common on some Windows ARM devices.

The application will still function normally because ffmpeg-static is optional.

To enable advanced video conversion, install FFmpeg separately:

winget install ffmpeg
Alternatively, set the FFMPEG_PATH environment variable manually.

If FFmpeg is unavailable, VLC can still be used as a fallback player.

License
MIT License
