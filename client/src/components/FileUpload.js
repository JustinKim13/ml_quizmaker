import React, { useState } from "react";
import '../styles/FileUpload.css';

// react component for uploading files
const FileUpload = ({ setGameData, username, onBack }) => {
    const [files, setFiles] = useState([]); // create state for storing uploaded PDF files      
    const [videoUrl, setVideoUrl] = useState(""); // state for storing optional video URL
    const [error, setError] = useState(""); // state for storing errors that occur

    const handleRemoveFile = (indexToRemove) => { // function to remove files from upload
        setFiles(prevFiles => Array.from(prevFiles).filter((_, index) => index !== indexToRemove)); // use setFiles to modify files state
    };

    const handleSubmit = async () => { // async makes function return a promise --  valid input -> resolution, invalid input -> rejection
        if (!files.length && !videoUrl.trim()) { // if there's no files or only whitespace
            setError("Please upload at least one file or provide a video URL"); // set error state
            return;
        }
        setError(""); // if no error occurs, set error state to empty string

        const formData = new FormData(); // create new instance of FormData object; saves pdfs, urls, and username
        for (let file of files) { // iterate through files
            formData.append("files", file); // append to formData object (key value pair of "files" : file)
        }
        formData.append("videoUrl", videoUrl); // append videoUrl 
        formData.append("username", username); // append username 

        try { // after adding these, try to post them to upload endpoint
            const response = await fetch("http://localhost:5000/api/upload", { // await allows us to wait for the post request to complete before proceeding to next line
                method: "POST", 
                body: formData, // post our formData to upload endpoint
            });

            if (!response.ok) { // if response isn't okay, ie, promise is rejected, throw an error
                throw new Error('Upload failed');
            }

            const data = await response.json(); // now that we know the response worked, we can get that data as a json object
            setGameData({ // state update functon
                ...data, // spread operator: takes all properties of data object which retains existing properties
                playerName: username, // playername set to username
                isProcessing: true // set isProcessing state to true
            });
            
        } catch (err) { // if any error occurs, set our error state to it
            console.error("Upload error:", err);
            setError("Failed to create game. Please try again.");
        }
    };

    return ( // return html of our page
        <div className="upload-container">
            <div className="animated-background"></div>
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
                                                x
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
