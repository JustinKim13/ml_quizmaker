from pypdf import PdfReader
from pdf2image import convert_from_path
from pytesseract import image_to_string
import os
import json
import datetime
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import traceback

def extract_text_from_pdf(file_path):
    """Extracts text from a PDF file using PyPDF. Falls back to OCR for pages without text."""
    try:
        reader = PdfReader(file_path)
        text_parts = []

        for page_num, page in enumerate(reader.pages):
            page_text = page.extract_text()
            if page_text and page_text.strip():
                text_parts.append(page_text)
            else:
                print(f"Page {page_num + 1}: No selectable text found, using OCR...")
                text_parts.append(extract_text_with_ocr_for_page(file_path, page_num))

        return "\n".join(text_parts).strip()
    except Exception as e:
        print(f"Error reading PDF file {file_path}: {e}")
        return ""

def extract_text_with_ocr(file_path):
    """Extracts text from a PDF file using OCR."""
    try:
        images = convert_from_path(file_path)
        with ThreadPoolExecutor() as executor:
            texts = executor.map(image_to_string, images)
        return "\n".join(texts).strip()
    except Exception as e:
        print(f"Error performing OCR on {file_path}: {e}")
        return ""

def extract_text_with_ocr_for_page(file_path, page_num):
    """Extracts text from a specific PDF page using OCR."""
    try:
        images = convert_from_path(file_path, first_page=page_num + 1, last_page=page_num + 1)
        return "\n".join(image_to_string(image) for image in images).strip()
    except Exception as e:
        print(f"Error performing OCR on page {page_num + 1} of {file_path}: {e}")
        return ""

def list_pdf_files(directory_path):
    """Lists all PDF files in the given directory."""
    try:
        files = [f for f in os.listdir(directory_path) if f.lower().endswith('.pdf')]
        if not files:
            print(f"No PDF files found in {directory_path}.")
        return files
    except Exception as e:
        print(f"Error accessing directory {directory_path}: {e}")
        return []

def update_status(message):
    """Updates the status file with current progress."""
    with open("ml_models/models/status.json", "w", encoding="utf-8") as f:
        json.dump({
            "status": "processing",
            "message": message,
            "timestamp": str(datetime.datetime.now())
        }, f)

def combine_selected_pdfs(directory_path, output_file_path):
    try:
        # Make sure we're using absolute paths
        abs_dir_path = os.path.abspath(directory_path)
        print(f"Looking for PDF files in: {abs_dir_path}")
        
        update_status("Reading PDF files...")
        pdf_files = list_pdf_files(abs_dir_path)
        
        if not pdf_files:
            print(f"No PDF files found in {abs_dir_path}")
            update_status("Error: No PDF files found")
            return False

        combined_text = []
        for file_name in pdf_files:
            update_status(f"Processing {file_name[14:]}...")
            file_path = os.path.join(abs_dir_path, file_name)
            
            # Add a timeout mechanism
            start_time = datetime.datetime.now()
            max_time = 300  # 5 minutes max per file
            
            print(f"Starting extraction from {file_name}")
            file_text = extract_text_from_pdf(file_path)
            
            # Check if extraction took too long
            elapsed = (datetime.datetime.now() - start_time).total_seconds()
            if elapsed > max_time:
                print(f"Warning: Extraction from {file_name} took {elapsed} seconds")
            
            # Check if we got meaningful text
            if len(file_text.strip()) < 100:
                print(f"Warning: Extracted very little text from {file_name} ({len(file_text)} chars)")
            else:
                print(f"Successfully extracted {len(file_text)} characters from {file_name}")
                
            combined_text.append(file_text)

        try:
            with open(output_file_path, "w", encoding="utf-8") as output_file:
                output_file.write("\n\n".join(combined_text))
            print(f"\nCombined text saved to: {output_file_path}")
            print(f"Total text length: {sum(len(t) for t in combined_text)} characters")
            return True
        except Exception as e:
            print(f"Error writing to output file {output_file_path}: {e}")
            return False

    except Exception as e:
        print(f"Error in combine_selected_pdfs: {e}")
        traceback.print_exc()  # Print full traceback
        return False

if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    input_dir = "ml_models/data_preprocessing/pdf_files"
    output_file = os.path.join(base_dir, "ml_models/outputs/combined_output.txt")
    combine_selected_pdfs(input_dir, output_file)
