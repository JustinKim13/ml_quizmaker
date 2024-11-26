import React, { useState, useEffect } from 'react';
import '../styles/Lobby.css';

const Lobby = ({ gameData, startGame, onBack }) => {
    const [isProcessing, setIsProcessing] = useState(true);
    const [questions, setQuestions] = useState(null);
    const [statusMessage, setStatusMessage] = useState('Starting...');
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        let pollInterval;
        
        const checkStatus = async () => {
            try {
                const response = await fetch('http://localhost:5000/api/status');
                const data = await response.json();
                
                console.log("Status check:", data);
                
                switch(data.status) {
                    case 'processing':
                        setStatusMessage(data.message || 'Processing...');
                        setProgress(prev => (prev < 90 ? prev + 2 : prev));
                        break;
                    case 'completed':
                        const questionsResponse = await fetch('http://localhost:5000/api/questions');
                        const questionsData = await questionsResponse.json();
                        
                        if (questionsData.questions && questionsData.questions.length > 0) {
                            setQuestions(questionsData.questions);
                            setIsProcessing(false);
                            setStatusMessage('Questions ready!');
                            setProgress(100);
                        }
                        break;
                    case 'error':
                        setStatusMessage(`Error: ${data.error}`);
                        setIsProcessing(false);
                        break;
                    default:
                        setStatusMessage('Processing...');
                }
            } catch (error) {
                console.error('Error checking status:', error);
                setStatusMessage('Error checking status');
            }
        };

        if (isProcessing) {
            pollInterval = setInterval(checkStatus, 1000);
            checkStatus();
        }

        return () => {
            if (pollInterval) {
                clearInterval(pollInterval);
            }
        };
    }, [isProcessing]);

    return (
        <div className="lobby">
            <div className="back-button" onClick={onBack}>
                ← Back
            </div>
            <div className="lobby-card">
                <h2>Game Lobby</h2>
                
                <div className="game-info">
                    <div className="info-item">
                        <span className="label">Game Code</span>
                        <span className="game-code">{gameData.gameCode}</span>
                    </div>
                    <div className="info-item">
                        <span className="label">Player</span>
                        <span className="player-name">{gameData.playerName}</span>
                    </div>
                </div>

                {isProcessing ? (
                    <div className="loading-container">
                        <div className="progress-bar">
                            <div 
                                className="progress-fill" 
                                style={{ width: `${progress}%` }}
                            ></div>
                        </div>
                        <div className="spinner"></div>
                        <p className="status-message">{statusMessage}</p>
                    </div>
                ) : questions ? (
                    <div className="questions-ready">
                        <div className="success-icon">✓</div>
                        <h3>Questions are ready!</h3>
                        <button onClick={startGame} className="start-game-button">
                            Start Game
                        </button>
                    </div>
                ) : (
                    <div className="error">
                        <div className="error-icon">!</div>
                        <p>Error loading questions. Please try again.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Lobby;
