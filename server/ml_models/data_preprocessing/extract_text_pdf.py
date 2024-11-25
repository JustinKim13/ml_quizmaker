from pypdf import PdfReader
from pdf2image import convert_from_path
from pytesseract import image_to_string
import os

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
    """
    Allows user to select specific PDFs from a directory and combines the text
    from selected PDFs into one text file.

    Args:
        directory_path (str): Path to the directory containing PDF files.
        output_file_path (str): Path to the output text file.

    Returns:
        None
    """
    # List all PDFs in the directory
    pdf_files = list_pdf_files(directory_path)
    if not pdf_files:
        return

    # Display the list of PDFs and prompt the user to select files
    print("\nAvailable PDF files:")
    for idx, file_name in enumerate(pdf_files, start=1):
        print(f"{idx}: {file_name}")
    
    ## FOR SELECTING SPECIFIC FILES
    
    # print("\nEnter the numbers of the PDFs you want to combine (comma-separated):")
    # selection = input("Selection: ")
    
    # try:
    #     selected_indices = [int(i) - 1 for i in selection.split(",") if i.strip().isdigit()]
    #     selected_files = [pdf_files[i] for i in selected_indices if 0 <= i < len(pdf_files)]
    # except Exception as e:
    #     print(f"Invalid selection: {e}")
    #     return
    
    ###
    
    # DEFAULT TO USING ALL FILES FOR NOW
    selected_files = pdf_files

    if not selected_files:
        print("No valid files selected.")
        return

    print(f"\nSelected files: {', '.join(selected_files)}")

    # Combine text from selected PDFs
    combined_text = ""
    for file_name in selected_files:
        file_path = os.path.join(directory_path, file_name)
        combined_text += extract_text_from_pdf(file_path) + "\n"

    # Save combined text to the output file
    try:
        with open(output_file_path, "w", encoding="utf-8") as output_file:
            output_file.write(combined_text)
        print(f"\nCombined text saved to: {output_file_path}")
    except Exception as e:
        print(f"Error writing to output file {output_file_path}: {e}")

if __name__ == "__main__":
    input_dir = "ml_models/data_preprocessing/pdf_files" 
    output_file = "ml_models/outputs/combined_output.txt"  
 
    combine_selected_pdfs(input_dir, output_file)
