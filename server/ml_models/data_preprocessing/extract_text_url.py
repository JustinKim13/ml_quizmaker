import argparse
import logging
import tempfile
import os
import datetime
import traceback
import sys
import io
import subprocess
import whisper
from s3_utils import write_json_to_s3, download_file, upload_file, list_files, read_json_from_s3
import yt_dlp

parser = argparse.ArgumentParser()
parser.add_argument('--game_code', type=str, required=True)
parser.add_argument('--append', type=str, default='False')
args = parser.parse_args()
game_code = args.game_code

# S3 paths
S3_PATHS = {
    'UPLOADS': f'uploads/{game_code}/',
    'QUESTIONS': f'questions/{game_code}/questions.json',
    'STATUS': f'status/{game_code}/status.json',
    'COMBINED_OUTPUT': f'outputs/{game_code}/combined_output.txt'
}

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def update_status(status, message, progress=None):
    global game_code
    status_data = {
        'status': status,
        'message': message,
        'timestamp': str(datetime.datetime.now())
    }
    if progress is not None:
        status_data['progress'] = progress
    write_json_to_s3(status_data, S3_PATHS['STATUS'])

def download_video_audio_to_tempfile(video_url):
    """Downloads best audio from video to a temp file using yt-dlp, returns the temp file path."""
    try:
        import tempfile
        import os
        # Get a temp file path WITHOUT extension
        fd, tmp_path = tempfile.mkstemp()
        os.close(fd)
        os.unlink(tmp_path)
        outtmpl = tmp_path  # no extension
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': outtmpl,
            'quiet': True,
            'no_warnings': True,
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'ffmpeg_location': '/opt/homebrew/bin/ffmpeg',
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])
        mp3_path = outtmpl + '.mp3'
        if not os.path.exists(mp3_path):
            raise FileNotFoundError(f"yt-dlp did not create expected mp3 file: {mp3_path}")
        return mp3_path
    except Exception as e:
        logger.error(f"Error downloading video audio: {e}")
        return None

def transcribe_audio(audio_path):
    """Transcribes audio file using Whisper."""
    try:
        model = whisper.load_model("base")
        result = model.transcribe(audio_path)
        return result["text"]
    except Exception as e:
        logger.error(f"Error transcribing audio: {e}")
        return ""

def append_to_combined_output_s3(text, s3_path):
    """Appends text to the combined output file in S3."""
    try:
        temp_file = tempfile.NamedTemporaryFile(delete=False, mode='a+', encoding='utf-8')
        temp_file.close()
        if download_file(s3_path, temp_file.name):
            with open(temp_file.name, 'a', encoding='utf-8') as f:
                f.write('\n\n' + text)
        else:
            with open(temp_file.name, 'w', encoding='utf-8') as f:
                f.write(text)
        upload_file(temp_file.name, s3_path)
        os.unlink(temp_file.name)
    except Exception as e:
        logger.error(f"Error appending to combined output: {e}")

def main():
    try:
        video_url = input().strip()
        should_append = args.append.lower() == 'true'
        update_status('processing', 'Starting video processing...', 10)
        audio_temp_path = download_video_audio_to_tempfile(video_url)
        if not audio_temp_path:
            logger.error("Failed to download video audio")
            update_status('error', 'Failed to download video audio')
            return
        update_status('processing', 'Transcribing video content...', 50)
        transcript = transcribe_audio(audio_temp_path)
        os.remove(audio_temp_path)  # Clean up temp file
        if transcript:
            append_to_combined_output_s3(transcript, S3_PATHS['COMBINED_OUTPUT'])
            update_status('video_extracted', 'Video processing completed successfully', 70)
        else:
            update_status('error', 'Failed to transcribe video')
    except Exception as e:
        logger.error(f"Error in main process: {str(e)}")
        update_status('error', f'Error: {str(e)}')

if __name__ == "__main__":
    main()
