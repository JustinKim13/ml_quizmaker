import boto3
import json
import os
from botocore.exceptions import ClientError
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize S3 client
s3_client = boto3.client(
    's3',
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
    region_name=os.getenv('AWS_REGION')
)

BUCKET_NAME = os.getenv('AWS_S3_BUCKET')

def upload_file(file_path, s3_key):
    """Upload a file to S3"""
    try:
        s3_client.upload_file(file_path, BUCKET_NAME, s3_key)
        logger.info(f"Successfully uploaded {file_path} to {s3_key}")
        return True
    except ClientError as e:
        logger.error(f"Error uploading file to S3: {str(e)}")
        return False

def download_file(s3_key, local_path):
    """Download a file from S3"""
    try:
        s3_client.download_file(BUCKET_NAME, s3_key, local_path)
        logger.info(f"Successfully downloaded {s3_key} to {local_path}")
        return True
    except ClientError as e:
        logger.error(f"Error downloading file from S3: {str(e)}")
        return False

def read_json_from_s3(s3_key):
    """Read and parse a JSON file from S3"""
    try:
        response = s3_client.get_object(Bucket=BUCKET_NAME, Key=s3_key)
        content = response['Body'].read().decode('utf-8')
        return json.loads(content)
    except ClientError as e:
        logger.error(f"Error reading JSON from S3: {str(e)}")
        return None

def write_json_to_s3(data, s3_key):
    """Write JSON data to S3"""
    try:
        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=json.dumps(data),
            ContentType='application/json'
        )
        logger.info(f"Successfully wrote JSON to {s3_key}")
        return True
    except ClientError as e:
        logger.error(f"Error writing JSON to S3: {str(e)}")
        return False

def list_files(prefix):
    """List files in S3 with given prefix"""
    try:
        response = s3_client.list_objects_v2(
            Bucket=BUCKET_NAME,
            Prefix=prefix
        )
        return [obj['Key'] for obj in response.get('Contents', [])]
    except ClientError as e:
        logger.error(f"Error listing files in S3: {str(e)}")
        return []

def delete_file(s3_key):
    """Delete a file from S3"""
    try:
        s3_client.delete_object(Bucket=BUCKET_NAME, Key=s3_key)
        logger.info(f"Successfully deleted {s3_key}")
        return True
    except ClientError as e:
        logger.error(f"Error deleting file from S3: {str(e)}")
        return False

def clear_directory(prefix):
    """Clear all files with given prefix from S3"""
    try:
        files = list_files(prefix)
        for file_key in files:
            delete_file(file_key)
        logger.info(f"Successfully cleared directory {prefix}")
        return True
    except ClientError as e:
        logger.error(f"Error clearing directory in S3: {str(e)}")
        return False 