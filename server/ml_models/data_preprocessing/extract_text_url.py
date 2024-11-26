import os
import subprocess
from moviepy.editor import AudioFileClip
import whisper
import sys
import json
import datetime


def download_video(video_url, output_dir="videos", cookies_file=None):
    """
    Downloads a video from a URL using yt-dlp.

    Args:
        video_url (str): The URL of the video.
        output_dir (str): Directory to save the video.
        cookies_file (str): Path to cookies file for authentication (optional).

    Returns:
        str: Path to the downloaded video file.
    """
    try:
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        video_path = os.path.join(output_dir, "downloaded_video.mp4")
        # Remove the existing file if it already exists
        if os.path.exists(video_path):
            os.remove(video_path)
        
        command = ["yt-dlp", "-f", "best", video_url, "-o", video_path]

        if cookies_file:
            command.extend(["--cookies", cookies_file])
        
        subprocess.run(command, check=True)
        print(f"Video downloaded to: {video_path}")
        return video_path
    except subprocess.CalledProcessError as e:
        print(f"Error downloading video with yt-dlp: {e}")
        return None


def extract_audio(video_path, audio_output_path="audio/audio.wav"):
    """
    Extracts audio from a video file.

    Args:
        video_path (str): Path to the video file.
        audio_output_path (str): Path to save the extracted audio.

    Returns:
        str: Path to the extracted audio file.
    """
    try:
        # Remove the existing audio file if it already exists
        if os.path.exists(audio_output_path):
            os.remove(audio_output_path)

        audio_clip = AudioFileClip(video_path)
        if not os.path.exists(os.path.dirname(audio_output_path)):
            os.makedirs(os.path.dirname(audio_output_path))
        audio_clip.write_audiofile(audio_output_path)
        print(f"Audio extracted to: {audio_output_path}")
        return audio_output_path
    except Exception as e:
        print(f"Error extracting audio: {e}")
        return None


def transcribe_audio(audio_path, model_name="base"):
    """
    Transcribes audio using OpenAI Whisper.

    Args:
        audio_path (str): Path to the audio file.
        model_name (str): Whisper model name (tiny, base, small, medium, large).

    Returns:
        str: Transcript of the audio.
    """
    try:
        model = whisper.load_model(model_name)
        result = model.transcribe(audio_path)
        transcript = result["text"]
        print("Transcript generated.")
        return transcript
    except Exception as e:
        print(f"Error transcribing audio: {e}")
        return ""


def append_to_combined_output(transcript, combined_output_path="ml_models/outputs/combined_output.txt"):
    """
    Appends the transcript to the combined output file.

    Args:
        transcript (str): The transcript text to append.
        combined_output_path (str): Path to the combined output file.

    Returns:
        None
    """
    try:
        # Ensure the directory exists
        os.makedirs(os.path.dirname(combined_output_path), exist_ok=True)

        # Append the transcript to the file
        with open(combined_output_path, "a", encoding="utf-8") as file:
            file.write("\n" + transcript + "\n")
        print(f"Transcript appended to: {combined_output_path}")
    except Exception as e:
        print(f"Error appending transcript to combined output: {e}")


def process_video_transcript(video_url, output_dir="ml_models/outputs/video_outputs"):
    """
    Processes a video URL to generate a transcript and save it.
    """
    try:
        if not video_url:  # Skip if no URL provided
            return ""
            
        # Update status for video download
        with open("ml_models/models/status.json", "w", encoding="utf-8") as f:
            json.dump({
                "status": "processing",
                "message": "Downloading video...",
                "timestamp": str(datetime.datetime.now())
            }, f)
            
        # Step 1: Download video
        video_path = download_video(video_url, output_dir=output_dir)
        if not video_path:
            return ""

        # Update status for audio extraction
        with open("ml_models/models/status.json", "w", encoding="utf-8") as f:
            json.dump({
                "status": "processing",
                "message": "Extracting audio from video...",
                "timestamp": str(datetime.datetime.now())
            }, f)

        # Step 2: Extract audio
        audio_path = os.path.join(output_dir, "audio.wav")
        audio_path = extract_audio(video_path, audio_output_path=audio_path)
        if not audio_path:
            return ""

        # Update status for transcription
        with open("ml_models/models/status.json", "w", encoding="utf-8") as f:
            json.dump({
                "status": "processing",
                "message": "Transcribing video content...",
                "timestamp": str(datetime.datetime.now())
            }, f)

        # Step 3: Transcribe audio
        transcript = transcribe_audio(audio_path)
        if not transcript:
            return ""

        # Step 4: Append transcript to combined output file
        combined_output_path = "ml_models/outputs/combined_output.txt"
        append_to_combined_output(transcript, combined_output_path=combined_output_path)

        return "Success"
    except Exception as e:
        print(f"Error processing video transcript: {e}")
        return ""


if __name__ == "__main__":
    try:
        # Read URL from stdin
        video_url = input().strip()
        if not video_url:
            print("Error: No video URL provided")
            sys.exit(1)
            
        output_dir = "ml_models/outputs/video_outputs"
        result = process_video_transcript(video_url, output_dir=output_dir)
        
        if result:
            print("Video processing completed successfully")
            sys.exit(0)
        else:
            print("Failed to process video")
            sys.exit(1)
            
    except Exception as e:
        print(f"Error: {str(e)}")
        sys.exit(1)
