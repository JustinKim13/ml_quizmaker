from pypdf import PdfReader
from pdf2image import convert_from_path
from pytesseract import image_to_string
import os
import json
import datetime
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import traceback
import sys
import logging
from pathlib import Path
import tempfile
from s3_utils import (
    list_files, download_file, upload_file,
    write_json_to_s3, read_json_from_s3
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# S3 paths
S3_PATHS = {
    'UPLOADS': 'uploads/',
    'QUESTIONS': 'questions/questions.json',
    'STATUS': 'status/status.json',
    'COMBINED_OUTPUT': 'outputs/combined_output.txt'
}

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

def update_status(status, message, progress=None):
    """Update the status file in S3"""
    status_data = {
        'status': status,
        'message': message,
        'timestamp': str(datetime.datetime.now())
    }
    if progress is not None:
        status_data['progress'] = progress
    write_json_to_s3(status_data, S3_PATHS['STATUS'])

def combine_selected_pdfs(directory_path, output_file_path):
    try:
        # Make sure we're using absolute paths
        abs_dir_path = os.path.abspath(directory_path)
        print(f"Looking for PDF files in: {abs_dir_path}")
        
        update_status("processing", "Reading PDF files...", 10)
        pdf_files = list_pdf_files(abs_dir_path)
        
        if not pdf_files:
            print(f"No PDF files found in {abs_dir_path}")
            update_status("error", "Error: No PDF files found", 10)
            return False

        combined_text = []
        for file_name in pdf_files:
            update_status("processing", f"Processing {file_name[14:]}...", 20)
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

def main():
    try:
        # Update status to processing at the very start
        update_status('processing', 'Starting PDF extraction...', 10)

        # Create temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            # List all PDF files in S3 uploads directory
            pdf_files = list_files(S3_PATHS['UPLOADS'])
            
            if not pdf_files:
                update_status('error', 'No PDF files found in uploads directory', 10)
                return

            combined_text = []
            total_files = len(pdf_files)
            
            # Process each PDF file
            for i, pdf_key in enumerate(pdf_files):
                # Calculate progress: 10-20% range for PDF extraction
                progress = 10 + (i / total_files * 10)
                
                # Download PDF to temporary directory
                temp_pdf_path = os.path.join(temp_dir, os.path.basename(pdf_key))
                if not download_file(pdf_key, temp_pdf_path):
                    logger.error(f"Failed to download {pdf_key}")
                    continue

                # Extract text from PDF
                text = extract_text_from_pdf(temp_pdf_path)
                if text:
                    combined_text.append(text)
                    update_status('processing', f'Processing PDF {i+1}/{total_files}...', int(progress))

            if not combined_text:
                update_status('error', 'Failed to extract text from any PDF files', 10)
                return

            # Combine all extracted text
            final_text = '\n\n'.join(combined_text)

            # Upload combined text to S3
            if not write_json_to_s3({'text': final_text}, S3_PATHS['COMBINED_OUTPUT']):
                update_status('error', 'Failed to save combined text', 10)
                return

            # Initialize empty questions file
            write_json_to_s3({'questions': []}, S3_PATHS['QUESTIONS'])

            # Update status to completed
            update_status('pdf_extracted', 'PDF extraction completed successfully', 20)

    except Exception as e:
        logger.error(f"Error in main process: {str(e)}")
        update_status('error', f'Error: {str(e)}')

if __name__ == "__main__":
    main()
