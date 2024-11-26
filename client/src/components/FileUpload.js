import React, { useState } from "react";
import '../styles/FileUpload.css';

const FileUpload = ({ setGameData, username, onBack }) => {
    const [files, setFiles] = useState([]);
    const [videoUrl, setVideoUrl] = useState("");
    const [error, setError] = useState("");

    const handleRemoveFile = (indexToRemove) => {
        setFiles(prevFiles => 
            Array.from(prevFiles).filter((_, index) => index !== indexToRemove)
        );
    };

    const handleSubmit = async () => {
        if (!files.length && !videoUrl.trim()) {
            setError("Please upload at least one file or provide a video URL");
            return;
        }
        setError("");

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
            <div className="back-button" onClick={onBack}>
                ← Back
            </div>
            <div className="user-profile">
                <div className="user-avatar">👤</div>
                <span className="username">{username}</span>
            </div>
            <div className="upload-card">
                <h2>Create Your Quiz</h2>
                <div className="form-container">
                    <div className="file-input-wrapper">
                        <label className="file-input-label">
                            <input
                                type="file"
                                accept=".pdf"
                                multiple
                                className="file-input"
                                onChange={(e) => {
                                    setFiles(Array.from(e.target.files));
                                    setError("");
                                }}
                            />
                            📄 Choose PDF Files
                        </label>
                        
                        {files.length > 0 && (
                            <ul className="file-list">
                                {Array.from(files).map((file, index) => (
                                    <li key={index}>
                                        <div className="file-info">
                                            <span className="file-icon">📄</span>
                                            <span className="file-name">{file.name}</span>
                                        </div>
                                        <div className="file-actions">
                                            <span className="file-size">
                                                {(file.size / 1024 / 1024).toFixed(2)} MB
                                            </span>
                                            <button 
                                                className="remove-file-button"
                                                onClick={() => handleRemoveFile(index)}
                                                title="Remove file"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="input-group">
                        <input
                            type="text"
                            placeholder="Enter video URL (optional)"
                            value={videoUrl}
                            onChange={(e) => {
                                setVideoUrl(e.target.value);
                                setError("");
                            }}
                        />
                    </div>

                    <div className="submit-wrapper">
                        <button className="submit-button" onClick={handleSubmit}>
                            Create Quiz
                        </button>
                        {error && <div className="error-message">{error}</div>}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FileUpload;
