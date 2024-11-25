import React, { useState } from "react";
import '../styles/FileUpload.css';

const FileUpload = ({ setGameData }) => {
    const [username, setUsername] = useState("");
    const [files, setFiles] = useState([]);
    const [videoUrl, setVideoUrl] = useState("");

    const handleSubmit = async () => {
        if (!username.trim()) {
            alert("Please enter a valid username.");
            return;
        }
        if (!files.length && !videoUrl.trim()) {
            alert("Please upload at least one file or provide a video URL.");
            return;
        }

        const gameCode = Math.random().toString(36).substr(2, 6).toUpperCase();
        const gameData = { 
            playerName: username, 
            files, 
            videoUrl, 
            gameCode,
            isProcessing: true
        };

        setGameData(gameData);

        const formData = new FormData();
        for (let file of files) {
            formData.append("files", file);
        }
        formData.append("videoUrl", videoUrl);
        formData.append("username", username);

        try {
            const response = await fetch("http://localhost:5000/api/upload", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                throw new Error('Upload failed');
            }
        } catch (err) {
            console.error("Upload error:", err);
        }
    };

    return (
        <div className="upload-container">
            <h2>Create Your Quiz</h2>
            <div className="input-group">
                <input
                    type="text"
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                />
            </div>
            
            <div className="file-input-wrapper">
                <label className="file-input-label">
                    Choose PDF Files
                    <input
                        type="file"
                        accept=".pdf"
                        multiple
                        className="file-input"
                        onChange={(e) => setFiles(Array.from(e.target.files))}
                    />
                </label>
                {files.length > 0 && (
                    <ul className="file-list">
                        {Array.from(files).map((file, index) => (
                            <li key={index}>{file.name}</li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="input-group">
                <input
                    type="text"
                    placeholder="Enter video URL (optional)"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                />
            </div>

            <button className="submit-button" onClick={handleSubmit}>
                Create Quiz
            </button>
        </div>
    );
};

export default FileUpload;
