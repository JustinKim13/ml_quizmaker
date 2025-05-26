import importlib
import sys
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

required_packages = [
    'sense2vec',
    'spacy',
    'thinc',
    'pypdf',
    'pytesseract',
    'pdf2image',
    'Pillow',
    'transformers',
    'tiktoken',
    'protobuf',
    'sentencepiece',
    'torch',
    'torchvision',
    'torchaudio',
    'sentence_transformers',
    'numpy',
    'huggingface_hub',
    'sklearn'
]

def check_package(package_name):
    try:
        importlib.import_module(package_name)
        logger.info(f"✓ {package_name} is installed")
        return True
    except ImportError as e:
        logger.error(f"✗ {package_name} is not installed: {str(e)}")
        return False

def main():
    logger.info("Checking required packages...")
    missing_packages = []
    
    for package in required_packages:
        if not check_package(package):
            missing_packages.append(package)
    
    if missing_packages:
        logger.error("\nMissing packages:")
        for package in missing_packages:
            logger.error(f"  - {package}")
        logger.error("\nPlease install missing packages using:")
        logger.error("pip install " + " ".join(missing_packages))
        sys.exit(1)
    else:
        logger.info("\nAll required packages are installed!")

if __name__ == "__main__":
    main() 