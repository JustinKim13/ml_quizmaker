from pypdf import PdfReader
from pdf2image import convert_from_path
from pytesseract import image_to_string
import os
import json
import datetime

def extract_text_from_pdf(file_path):
    """
    Extracts text from a PDF file using PyPDF. Falls back to OCR for pages without selectable text.

    Args:
        file_path (str): Path to the PDF file.

    Returns:
        str: Extracted text from the entire PDF.
    """
    try:
        reader = PdfReader(file_path)
        text = ""

        for page_num, page in enumerate(reader.pages):
            # Try to extract selectable text
            page_text = page.extract_text()
            if page_text and page_text.strip():
                text += page_text + "\n"
            else:
                # Fallback to OCR for this page
                print(f"Page {page_num + 1}: No selectable text found, using OCR...")
                text += extract_text_with_ocr_for_page(file_path, page_num) + "\n"

        return text.strip()
    except Exception as e:
        print(f"Error reading PDF file {file_path}: {e}")
        return ""

def extract_text_with_ocr(file_path):
    """
    Extracts text from a PDF file using OCR.

    Args:
        file_path (str): Path to the PDF file.

    Returns:
        str: Extracted text from the entire PDF using OCR.
    """
    try:
        # Convert PDF to images
        images = convert_from_path(file_path)
        text = ""
        for image in images:
            # Extract text from each image using pytesseract
            text += image_to_string(image) + "\n"
        return text.strip()
    except Exception as e:
        print(f"Error performing OCR on {file_path}: {e}")
        return ""

def extract_text_with_ocr_for_page(file_path, page_num):
    """
    Extracts text from a specific page of a PDF file using OCR.

    Args:
        file_path (str): Path to the PDF file.
        page_num (int): Page number (0-based index).

    Returns:
        str: Extracted text from the specific page using OCR.
    """
    try:
        # Convert specific page to image
        images = convert_from_path(file_path, first_page=page_num + 1, last_page=page_num + 1)
        text = ""
        for image in images:
            # Extract text from the image using pytesseract
            text += image_to_string(image) + "\n"
        return text.strip()
    except Exception as e:
        print(f"Error performing OCR on page {page_num + 1} of {file_path}: {e}")
        return ""

def list_pdf_files(directory_path):
    """
    Lists all PDF files in the given directory.

    Args:
        directory_path (str): Path to the directory.

    Returns:
        list: List of PDF file names.
    """
    try:
        files = [f for f in os.listdir(directory_path) if f.endswith(".pdf")]
        if not files:
            print(f"No PDF files found in {directory_path}.")
        return files
    except Exception as e:
        print(f"Error accessing directory {directory_path}: {e}")
        return []

def combine_selected_pdfs(directory_path, output_file_path):
    try:
        # Update status for PDF processing
        with open("ml_models/models/status.json", "w", encoding="utf-8") as f:
            json.dump({
                "status": "processing",
                "message": "Reading PDF files...",
                "timestamp": str(datetime.datetime.now())
            }, f)
            
        # List all PDFs in the directory
        pdf_files = list_pdf_files(directory_path)
        if not pdf_files:
            return

        # Process PDFs
        combined_text = ""
        for file_name in pdf_files:
            with open("ml_models/models/status.json", "w", encoding="utf-8") as f:
                json.dump({
                    "status": "processing",
                    "message": f"Processing {file_name}...",
                    "timestamp": str(datetime.datetime.now())
                }, f)
                
            file_path = os.path.join(directory_path, file_name)
            combined_text += extract_text_from_pdf(file_path) + "\n"

        # Save combined text
        try:
            with open(output_file_path, "w", encoding="utf-8") as output_file:
                output_file.write(combined_text)
            print(f"\nCombined text saved to: {output_file_path}")
        except Exception as e:
            print(f"Error writing to output file {output_file_path}: {e}")

    except Exception as e:
        print(f"Error in combine_selected_pdfs: {e}")

if __name__ == "__main__":
    input_dir = "ml_models/data_preprocessing/pdf_files" 
    # Get absolute path
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    output_file = os.path.join(base_dir, "ml_models/outputs/combined_output.txt")
 
    combine_selected_pdfs(input_dir, output_file)
