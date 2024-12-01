import React, { useState } from "react";
import '../styles/LandingPage.css';

const LandingPage = ({ onStart }) => {
    const [username, setUsername] = useState("");
    const [error, setError] = useState("");

    const handleButtonClick = (action) => {
        if (!username.trim()) {
            setError("Please enter a username");
            return;
        }
        onStart(username, action);
    };

    return (
        <div className="landing-container">
            <div className="animated-background"></div>
            <div className="landing-card">
                <div className="landing-content">
                    <h2>Welcome to QuizClash</h2>
                    <div className="form-container">
                        <div className="input-group">
                            <input
                                type="text"
                                placeholder="Enter your username"
                                value={username}
                                onChange={(e) => {
                                    setUsername(e.target.value);
                                    setError("");
                                }}
                                className={error ? "error" : ""}
                            />
                            {error && <div className="error-message">{error}</div>}
                        </div>
                        
                        <div className="button-group">
                            <button 
                                className="action-button create"
                                onClick={() => handleButtonClick('create')}
                            >
                                Create Game
                            </button>
                            <button 
                                className="action-button join"
                                onClick={() => handleButtonClick('join')}
                            >
                                Join Game
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LandingPage; 