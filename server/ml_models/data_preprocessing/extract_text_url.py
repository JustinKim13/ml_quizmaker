import os
import subprocess
from moviepy.editor import AudioFileClip
import whisper
import sys
import json
import datetime
from pathlib import Path

def update_status(message):
    """Updates status file with current processing state."""
    with open("ml_models/models/status.json", "w", encoding="utf-8") as f:
        json.dump({
            "status": "processing",
            "message": message,
            "timestamp": str(datetime.datetime.now())
        }, f)

def download_video(video_url, output_dir="videos", cookies_file=None):
    """Downloads a video from a URL using yt-dlp."""
    try:
        Path(output_dir).mkdir(parents=True, exist_ok=True)
        video_path = os.path.join(output_dir, "downloaded_video.mp4")
        
        if os.path.exists(video_path):
            os.remove(video_path)
        
        command = ["yt-dlp", "-f", "best", video_url, "-o", video_path]
        if cookies_file:
            command.extend(["--cookies", cookies_file])
        
        subprocess.run(command, check=True, capture_output=True)
        print(f"Video downloaded to: {video_path}")
        return video_path
    except subprocess.CalledProcessError as e:
        print(f"Error downloading video with yt-dlp: {e}")
        return None

def extract_audio(video_path, audio_output_path="audio/audio.wav"):
    """Extracts audio from a video file."""
    try:
        if os.path.exists(audio_output_path):
            os.remove(audio_output_path)

        Path(os.path.dirname(audio_output_path)).mkdir(parents=True, exist_ok=True)
        with AudioFileClip(video_path) as audio_clip:
            audio_clip.write_audiofile(audio_output_path)
            
        print(f"Audio extracted to: {audio_output_path}")
        return audio_output_path
    except Exception as e:
        print(f"Error extracting audio: {e}")
        return None

def transcribe_audio(audio_path, model_name="base"):
    """Transcribes audio using OpenAI Whisper."""
    try:
        model = whisper.load_model(model_name)
        result = model.transcribe(audio_path)
        print("Transcript generated.")
        return result["text"]
    except Exception as e:
        print(f"Error transcribing audio: {e}")
        return ""

def append_to_combined_output(transcript, combined_output_path="ml_models/outputs/combined_output.txt"):
    """Appends the transcript to the combined output file."""
    try:
        Path(os.path.dirname(combined_output_path)).mkdir(parents=True, exist_ok=True)
        with open(combined_output_path, "a", encoding="utf-8") as file:
            file.write(f"\n{transcript}\n")
        print(f"Transcript appended to: {combined_output_path}")
    except Exception as e:
        print(f"Error appending transcript to combined output: {e}")

def process_video_transcript(video_url, output_dir="ml_models/outputs/video_outputs"):
    """Processes a video URL to generate a transcript and save it."""
    try:
        if not video_url:
            return ""
            
        update_status("Downloading video...")
        video_path = download_video(video_url, output_dir=output_dir)
        if not video_path:
            return ""

        update_status("Extracting audio from video...")
        audio_path = os.path.join(output_dir, "audio.wav")
        audio_path = extract_audio(video_path, audio_output_path=audio_path)
        if not audio_path:
            return ""

        update_status("Transcribing video content...")
        transcript = transcribe_audio(audio_path)
        if not transcript:
            return ""

        append_to_combined_output(transcript, "ml_models/outputs/combined_output.txt")
        return "Success"
    except Exception as e:
        print(f"Error processing video transcript: {e}")
        return ""

if __name__ == "__main__":
    try:
        video_url = input().strip()
        if not video_url:
            print("Error: No video URL provided")
            sys.exit(1)
            
        result = process_video_transcript(video_url, output_dir="ml_models/outputs/video_outputs")
        
        if result:
            print("Video processing completed successfully")
            sys.exit(0)
        else:
            print("Failed to process video")
            sys.exit(1)
            
    except Exception as e:
        print(f"Error: {str(e)}")
        sys.exit(1)
