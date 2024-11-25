import React, { useState, useEffect } from 'react';
import GamePlay from './GamePlay';
import '../styles/FileUpload.css';

const Lobby = ({ gameData }) => {
    const [isProcessing, setIsProcessing] = useState(gameData.isProcessing);
    const [questions, setQuestions] = useState(null);
    const [gameStarted, setGameStarted] = useState(false);

    useEffect(() => {
        const checkStatus = async () => {
            if (!isProcessing) return;

            try {
                const response = await fetch('/api/status');
                const data = await response.json();
                
                if (data.questionsGenerated) {
                    // Questions are ready, fetch them
                    const questionsResponse = await fetch('/api/questions');
                    const questionsData = await questionsResponse.json();
                    setQuestions(questionsData.questions);
                    setIsProcessing(false);
                } else {
                    // Check again in 2 seconds
                    setTimeout(checkStatus, 2000);
                }
            } catch (error) {
                console.error('Error checking status:', error);
            }
        };

        checkStatus();
    }, [isProcessing]);

    const handleGameFinish = () => {
        // Handle game finish (can add score display or return to lobby)
        setGameStarted(false);
    };

    if (gameStarted && questions) {
        return <GamePlay questions={questions} onFinish={handleGameFinish} />;
    }

    return (
        <div className="lobby">
            <h2>Game Lobby</h2>
            <p>Game Code: {gameData.gameCode}</p>
            <p>Player: {gameData.playerName}</p>

            {isProcessing ? (
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>Generating questions...</p>
                </div>
            ) : questions ? (
                <div className="questions-ready">
                    <h3>Questions are ready!</h3>
                    <button 
                        className="start-game-button"
                        onClick={() => setGameStarted(true)}
                    >
                        Start Game
                    </button>
                </div>
            ) : (
                <div className="error">
                    <p>Error loading questions. Please try again.</p>
                </div>
            )}
        </div>
    );
};

export default Lobby;
