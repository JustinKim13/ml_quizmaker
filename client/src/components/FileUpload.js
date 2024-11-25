import React, { useState } from "react";
import '../styles/FileUpload.css';

const FileUpload = ({ setGameData }) => {
    const [username, setUsername] = useState("");
    const [files, setFiles] = useState([]);
    const [videoUrl, setVideoUrl] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async () => {
        if (!username.trim()) {
            alert("Please enter a valid username.");
            return;
        }
        if (!files.length && !videoUrl.trim()) {
            alert("Please upload at least one file or provide a video URL.");
            return;
        }

        const formData = new FormData();
        for (let file of files) {
            formData.append("files", file);
        }
        formData.append("videoUrl", videoUrl);
        formData.append("username", username);

        const gameCode = Math.random().toString(36).substr(2, 6).toUpperCase();
        const gameData = { 
            playerName: username, 
            files, 
            videoUrl, 
            gameCode,
            isProcessing: true
        };
        
        try {
            console.log("Sending request to server...");
            const response = await fetch("http://localhost:5000/api/upload", {
                method: "POST",
                body: formData,
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                }
            });

            const responseData = await response.json();
            console.log("Server response:", responseData);

            if (!response.ok) {
                throw new Error(responseData.error || 'Upload failed');
            }

            console.log("Upload successful, transitioning to lobby...");
            setGameData(gameData);
        } catch (err) {
            console.error("Detailed upload error:", err);
            alert(`Error uploading files: ${err.message}`);
        }
    };

    return (
        <div>
            <h2>Upload PDF(s) or Video URL</h2>
            <button onClick={() => setIsLoading(!isLoading)}>
                Toggle Loading (Test)
            </button>
            
            {isLoading ? (
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>Generating questions...</p>
                </div>
            ) : (
                <>
                    <input
                        type="text"
                        placeholder="Enter your username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                    <input
                        type="file"
                        accept=".pdf"
                        multiple
                        onChange={(e) => setFiles(Array.from(e.target.files))}
                    />
                    <input
                        type="text"
                        placeholder="Enter video URL"
                        value={videoUrl}
                        onChange={(e) => setVideoUrl(e.target.value)}
                    />
                    <button onClick={handleSubmit}>Submit</button>
                </>
            )}
        </div>
    );
};

export default FileUpload;
