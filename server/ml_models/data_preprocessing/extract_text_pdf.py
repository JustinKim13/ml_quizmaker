"""
PDF Text Extraction Module

This module extracts text from PDF files stored in S3, processes them using PyPDF2 
with OCR fallback, and stores the combined output back to S3.
"""

import os
import json
import datetime
import tempfile
import logging
import argparse
import traceback
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from pypdf import PdfReader
from pdf2image import convert_from_path
from pytesseract import image_to_string

from s3_utils import (
    list_files, download_file, upload_file,
    write_json_to_s3, read_json_from_s3
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Constants
MAX_EXTRACTION_TIME = 300  # 5 minutes max per file
MIN_TEXT_LENGTH = 100  # Minimum characters to consider meaningful text


class PDFExtractor:
    """Handles PDF text extraction with OCR fallback."""
    
    def __init__(self, game_code):
        self.game_code = game_code
        self.s3_paths = {
            'UPLOADS': f'uploads/{game_code}/',
            'QUESTIONS': f'questions/{game_code}/questions.json',
            'STATUS': f'status/{game_code}/status.json',
            'COMBINED_OUTPUT': f'outputs/{game_code}/combined_output.txt'
        }
    
    def extract_text_from_pdf(self, file_path):
        """
        Extract text from a PDF file using PyPDF with OCR fallback.
        
        Args:
            file_path (str): Path to the PDF file
            
        Returns:
            str: Extracted text content
        """
        try:
            reader = PdfReader(file_path)
            text_parts = []

            for page_num, page in enumerate(reader.pages):
                page_text = page.extract_text()
                if page_text and page_text.strip():
                    text_parts.append(page_text)
                else:
                    logger.info(f"Page {page_num + 1}: No selectable text found, using OCR...")
                    ocr_text = self._extract_text_with_ocr_for_page(file_path, page_num)
                    if ocr_text:
                        text_parts.append(ocr_text)

            return "\n".join(text_parts).strip()
            
        except Exception as e:
            logger.error(f"Error reading PDF file {file_path}: {e}")
            return ""

    def _extract_text_with_ocr_for_page(self, file_path, page_num):
        """
        Extract text from a specific PDF page using OCR.
        
        Args:
            file_path (str): Path to the PDF file
            page_num (int): Page number (0-indexed)
            
        Returns:
            str: Extracted text from the page
        """
        try:
            images = convert_from_path(
                file_path, 
                first_page=page_num + 1, 
                last_page=page_num + 1
            )
            return "\n".join(image_to_string(image) for image in images).strip()
            
        except Exception as e:
            logger.error(f"Error performing OCR on page {page_num + 1} of {file_path}: {e}")
            return ""

    def update_status(self, status, message, progress=None):
        """
        Update the processing status in S3.
        
        Args:
            status (str): Current status
            message (str): Status message
            progress (int, optional): Progress percentage
        """
        status_data = {
            'status': status,
            'message': message,
            'timestamp': str(datetime.datetime.now())
        }
        if progress is not None:
            status_data['progress'] = progress
            
        try:
            write_json_to_s3(status_data, self.s3_paths['STATUS'])
        except Exception as e:
            logger.error(f"Failed to update status: {e}")

    def _append_to_combined_output_s3(self, text):
        """
        Append extracted text to the combined output file in S3.
        
        Args:
            text (str): Text to append
        """
        temp_file = tempfile.NamedTemporaryFile(delete=False, mode='a+', encoding='utf-8')
        temp_file.close()
        
        try:
            # Download existing file if it exists
            if download_file(self.s3_paths['COMBINED_OUTPUT'], temp_file.name):
                with open(temp_file.name, 'a', encoding='utf-8') as f:
                    f.write('\n\n' + text)
            else:
                with open(temp_file.name, 'w', encoding='utf-8') as f:
                    f.write(text)
            
            # Upload updated file
            upload_file(temp_file.name, self.s3_paths['COMBINED_OUTPUT'])
            
        except Exception as e:
            logger.error(f"Failed to append to combined output: {e}")
        finally:
            if os.path.exists(temp_file.name):
                os.unlink(temp_file.name)

    def process_pdf_files(self):
        """
        Main processing function to extract text from all PDF files in S3.
        
        Returns:
            bool: True if processing completed successfully, False otherwise
        """
        try:
            self.update_status('processing', 'Starting PDF extraction...', 0)

            # List all PDF files in S3 uploads directory
            pdf_files = list_files(self.s3_paths['UPLOADS'])
            if not pdf_files:
                self.update_status('error', 'No PDF files found in uploads directory', 0)
                return False

            total_files = len(pdf_files)
            logger.info(f"Found {total_files} PDF files to process")

            for i, pdf_key in enumerate(pdf_files):
                progress = int((i / total_files) * 20)  # Progress from 0% to 20%
                filename = os.path.basename(pdf_key)
                
                logger.info(f"Processing file {i+1}/{total_files}: {filename}")
                self.update_status('processing', f'Processing {filename}...', progress)
                
                # Process individual PDF file
                if self._process_single_pdf(pdf_key):
                    logger.info(f"Successfully processed {filename}")
                else:
                    logger.warning(f"Failed to process {filename}")

            # Initialize empty questions file
            write_json_to_s3({'questions': []}, self.s3_paths['QUESTIONS'])
            self.update_status('pdf_extracted', 'PDF extraction completed successfully', 20)
            
            logger.info("PDF extraction process completed successfully")
            return True

        except Exception as e:
            error_msg = f"Error in PDF processing: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            self.update_status('error', error_msg)
            return False

    def _process_single_pdf(self, pdf_key):
        """
        Process a single PDF file from S3.
        
        Args:
            pdf_key (str): S3 key for the PDF file
            
        Returns:
            bool: True if processing was successful, False otherwise
        """
        temp_pdf_path = None
        try:
            # Download PDF to temporary file
            with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as temp_pdf:
                temp_pdf_path = temp_pdf.name

            if not download_file(pdf_key, temp_pdf_path):
                logger.error(f"Failed to download {pdf_key}")
                return False

            # Extract text with timeout tracking
            start_time = datetime.datetime.now()
            text = self.extract_text_from_pdf(temp_pdf_path)
            elapsed = (datetime.datetime.now() - start_time).total_seconds()

            # Log extraction results
            if elapsed > MAX_EXTRACTION_TIME:
                logger.warning(f"Extraction took {elapsed:.1f} seconds (longer than expected)")

            if len(text.strip()) < MIN_TEXT_LENGTH:
                logger.warning(f"Extracted very little text ({len(text)} chars)")
                return False
            else:
                logger.info(f"Successfully extracted {len(text)} characters")

            # Append to combined output
            if text:
                self._append_to_combined_output_s3(text)
                return True

            return False

        except Exception as e:
            logger.error(f"Error processing {pdf_key}: {e}")
            return False
        finally:
            # Clean up temporary file
            if temp_pdf_path and os.path.exists(temp_pdf_path):
                os.unlink(temp_pdf_path)


def main():
    """Main entry point for the PDF extraction script."""
    parser = argparse.ArgumentParser(description='Extract text from PDF files in S3')
    parser.add_argument('--game_code', type=str, required=True, 
                       help='Game code to identify the S3 directory structure')
    args = parser.parse_args()

    extractor = PDFExtractor(args.game_code)
    success = extractor.process_pdf_files()
    
    if not success:
        logger.error("PDF extraction failed")
        exit(1)
    
    logger.info("PDF extraction completed successfully")


if __name__ == "__main__":
    main()
