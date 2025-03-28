import React, { useState } from "react";
import '../styles/FileUpload.css';

// react component for uploading files
const FileUpload = ({ setGameData, username, onBack }) => {
    const [files, setFiles] = useState([]); // create state for storing uploaded PDF files      
    const [videoUrl, setVideoUrl] = useState(""); // state for storing optional video URL
    const [error, setError] = useState(""); // state for storing errors that occur
    const [isPrivate, setIsPrivate] = useState(false)
    const [timePerQuestion, setTimePerQuestion] = useState(30); // Default 30 seconds
    const [numQuestions, setNumQuestions] = useState(10); // Default 10 questions
    const [showAdvanced, setShowAdvanced] = useState(false);  // Add this with your other state variables

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
        formData.append("isPrivate", isPrivate)
        formData.append("timePerQuestion", timePerQuestion)
        formData.append("numQuestions", numQuestions)

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
                isProcessing: true, // set isProcessing state to true
                timePerQuestion,
                numQuestions
            });
            
        } catch (err) { // if any error occurs, set our error state to it
            console.error("Upload error:", err);
            setError("Failed to create game. Please try again.");
        }
    };

    return (
        <div className="upload-container">
            <div className="animated-background"></div>
            <div className="back-button" onClick={onBack}>← Back</div>
            <div className="user-profile">
                <div className="user-avatar">👤</div>
                <span className="username">{username}</span>
            </div>
            <div className="upload-card">
                <h2>Create Your Quiz</h2>
                <div className="form-container">
                    <div className="file-input-wrapper">
                    <div className="file-input-wrapper">
                    <label className="file-input-label">
                        <input
                            type="file"
                            accept=".pdf"
                            multiple
                            className="file-input"
                            onChange={(e) => {
                                const selectedFiles = Array.from(e.target.files);
                                if (files.length + selectedFiles.length > 5) {
                                    setError("You can upload a maximum of 5 files.");
                                } else {
                                    setFiles((prevFiles) => [...prevFiles, ...selectedFiles]);
                                    setError("");
                                }
                            }}
                        />
                        📄 Choose PDF Files
                    </label>

                    {files.length > 0 && (
                        <ul className="file-list">
                            {files.map((file, index) => (
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
                                        >
                                            x
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
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
                            className="url-input"
                        />
                    </div>

                    <div className="settings-section">
                        <div className="control-item private-game-checkbox">
                            <label htmlFor="privateGameCheckbox" className="private-game-label">
                            Private Game
                            </label>
                            <input
                            type="checkbox"
                            checked={isPrivate}
                            onChange={() => setIsPrivate(!isPrivate)}
                            id="privateGameCheckbox"
                            />
                        </div>
                        </div>

                        

                        <button 
                        className="advanced-settings-toggle"
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        >
                        {showAdvanced ? '▼ Advanced Settings' : '▶ Advanced Settings'}
                        </button>

                        <div className={`advanced-settings ${showAdvanced ? 'show' : ''}`}>
                        <div className="control-item">
                            <label className="control-label">Time per Question: {timePerQuestion}s</label>
                            <div className="slider-container">
                            <input
                                type="range"
                                min="3"
                                max="300"
                                value={timePerQuestion}
                                onChange={(e) => setTimePerQuestion(parseInt(e.target.value))}
                                className="slider"
                            />
                            <div className="slider-labels">
                                <span>3s</span>
                                <span>5m</span>
                            </div>
                            </div>
                        </div>
                        <div className="control-item">
                            <label className="control-label">Number of Questions: {numQuestions}</label>
                            <div className="slider-container">
                            <input
                                type="range"
                                min="1"
                                max="20"
                                value={numQuestions}
                                onChange={(e) => setNumQuestions(parseInt(e.target.value))}
                                className="slider"
                            />
                            <div className="slider-labels">
                                <span>1</span>
                                <span>20</span>
                            </div>
                            </div>
                        </div>
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