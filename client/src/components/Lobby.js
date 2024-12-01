import React, { useState, useEffect } from 'react';
import '../styles/Lobby.css';

const Lobby = ({ gameData, startGame, onBack }) => {
    const [isProcessing, setIsProcessing] = useState(gameData.isHost);
    const [questions, setQuestions] = useState(null);
    const [statusMessage, setStatusMessage] = useState(gameData.isHost ? 'Starting...' : 'Waiting for host...');
    const [progress, setProgress] = useState(0);
    const [players, setPlayers] = useState([{ 
        name: gameData?.playerName, 
        isHost: gameData?.isHost 
    }]);

    useEffect(() => {
        let pollInterval;
        
        const checkStatus = async () => {
            try {
                const response = await fetch('http://localhost:5000/api/status');
                const data = await response.json();
                
                if (gameData.isHost) {
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
                    }
                } else {
                    setStatusMessage('Waiting for host to start the game...');
                }
            } catch (error) {
                console.error('Error checking status:', error);
            }
        };

        if (isProcessing && gameData.isHost) {
            pollInterval = setInterval(checkStatus, 1000);
            checkStatus();
        }

        return () => {
            if (pollInterval) {
                clearInterval(pollInterval);
            }
        };
    }, [isProcessing, gameData.isHost]);

    useEffect(() => {
        let pollInterval;
        
        const pollPlayers = async () => {
            if (!gameData?.gameCode) return;
            
            try {
                const response = await fetch(`http://localhost:5000/api/game/${gameData.gameCode}/players`);
                const data = await response.json();
                if (data.players) {
                    setPlayers(data.players);
                }
            } catch (error) {
                console.error('Error fetching players:', error);
            }
        };

        pollInterval = setInterval(pollPlayers, 2000);
        pollPlayers();

        return () => {
            if (pollInterval) {
                clearInterval(pollInterval);
            }
        };
    }, [gameData?.gameCode]);

    return (
        <div className="lobby">
            <div className="animated-background"></div>
            <div className="back-button" onClick={onBack}>
                ← Back
            </div>
            <div className="lobby-card">
                <h2>Game Lobby</h2>
                
                <div className="game-info">
                    <div className="info-item">
                        <span className="label">Game Code</span>
                        <span className="game-code">{gameData?.gameCode}</span>
                    </div>
                    <div className="info-item">
                        <span className="label">Players</span>
                        <div className="players-list">
                            {Array.isArray(players) && players.map((player, index) => (
                                <div key={index} className="player-item">
                                    <span className="player-name">{player.name}</span>
                                    {player.isHost && <span className="host-badge">Host</span>}
                                </div>
                            ))}
                        </div>
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
                        {gameData.isHost && (
                            <button onClick={startGame} className="start-game-button">
                                Start Game
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="waiting-message">
                        <p>{statusMessage}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Lobby;
