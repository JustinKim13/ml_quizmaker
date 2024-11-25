This project extracts text from PDF files, combining both selectable text and scanned images (using OCR). It automatically processes all PDF files in a specified directory and outputs the combined text into a single file.

---

## Prerequisites

### Install Tesseract OCR
This project requires **Tesseract OCR** to be installed on your system.

#### macOS
Install Tesseract using Homebrew:
```bash
brew install tesseract
```

#### Ubuntu/Debian
Install Tesseract using APT:
```bash
sudo apt install tesseract-ocr
```

#### Windows
Download and install Tesseract OCR from the official [Tesseract GitHub page](https://github.com/tesseract-ocr/tesseract).

Verify the installation:
```bash
tesseract --version
```

---

### Install Python Dependencies
Ensure you have Python 3.8 or above installed. Install the required Python libraries using `pip`:
```bash
pip install -r requirements.txt
```

BREW POPPLER