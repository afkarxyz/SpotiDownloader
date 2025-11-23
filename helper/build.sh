#!/bin/bash
# Build script for Linux/macOS helper binary

set -e

echo "Building gettoken helper..."

# Detect OS
OS=$(uname -s)
case "$OS" in
    Linux*)
        PLATFORM="linux-amd64"
        ;;
    Darwin*)
        PLATFORM="darwin-universal"
        ;;
    *)
        echo "Error: Unsupported operating system: $OS"
        exit 1
        ;;
esac

echo "Detected platform: $PLATFORM"

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed"
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
pip3 install pyinstaller DrissionPage

# Build the binary (cf_bypasser.py will be included automatically)
echo "Building binary for $PLATFORM..."
pyinstaller --onefile --name "gettoken-$PLATFORM" get_token.py

# Copy to backend/bin
echo "Copying binary to backend/bin..."
mkdir -p ../backend/bin
cp "dist/gettoken-$PLATFORM" "../backend/bin/gettoken-$PLATFORM"
chmod +x "../backend/bin/gettoken-$PLATFORM"

echo ""
echo "Build complete! Binary saved to: backend/bin/gettoken-$PLATFORM"
echo ""
