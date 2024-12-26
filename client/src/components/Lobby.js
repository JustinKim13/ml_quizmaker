import React, { useState, useEffect } from 'react';
import '../styles/Lobby.css';

const Lobby = ({ gameData, startGame, onBack }) => {
    const [isProcessing, setIsProcessing] = useState(gameData.isHost); // only show processing to host
    const [questions, setQuestions] = useState(null); // state for questions, set to null initially
    const [statusMessage, setStatusMessage] = useState(gameData.isHost ? 'Starting...' : 'Waiting for host...'); // state for status message, depends on if user is host or not
    const [progress, setProgress] = useState(0); // progress starts at 0 for loading
    const [players, setPlayers] = useState([{  // players default to gameData players and host
        name: gameData?.playerName, 
        isHost: gameData?.isHost 
    }]);
    const [hostLeft, setHostLeft] = useState(false); // start with host in lobby, if they leave, cancel game

    useEffect(() => { // useEffect for side effects
        let pollInterval;
        
        const checkStatus = async () => { // function to check status of processing
            try {
                const response = await fetch('http://localhost:5000/api/status'); // first check endpoint
                const data = await response.json(); // fetch data json object from response
                
                if (gameData.isHost) { // if user is host
                    switch(data.status) { // switch the status depending on case
                        case 'processing':
                            setStatusMessage(data.message || 'Processing...');
                            setProgress(prev => (prev < 90 ? prev + 2 : prev)); // adjust progress accordingly
                            break;
                        case 'completed':
                            const questionsResponse = await fetch('http://localhost:5000/api/questions'); // if processing is complete, fetch our questions that have been generated
                            const questionsData = await questionsResponse.json(); // save questions data as json response object
                            
                            if (questionsData.questions && questionsData.questions.length > 0) { // if there's questions
                                setQuestions(questionsData.questions); // set questions to the questions from data
                                setIsProcessing(false); // end processing
                                setStatusMessage('Questions ready!'); // display processing ready
                                setProgress(100); // finish progress
                            }
                            break;
                        case 'error':
                            setStatusMessage(`Error: ${data.error}`);
                            setIsProcessing(false);
                            break;
                        default:
                            setStatusMessage('Unknown status received. Please try again later.'); // Default case for unexpected statuses
                            break;
                    } 
                } else { // for non-host, just display this message
                    setStatusMessage('Waiting for host to start the game...');
                }
            } catch (error) { // catch any errors along the way
                console.error('Error checking status:', error);
            }
        };

        if (isProcessing && gameData.isHost) { // for host and while processing, we'll check status every second
            pollInterval = setInterval(checkStatus, 1000);
            checkStatus();
        }

        return () => {
            if (pollInterval) { // if pollInterval remains after component unmounts, clear it
                clearInterval(pollInterval);
            }
        };
    }, [isProcessing, gameData.isHost]); // dependencies

    useEffect(() => {
        let pollInterval;
        
        const checkGameStatus = async () => {
            try {
                const response = await fetch(`http://localhost:5000/api/game/${gameData.gameCode}/players`); // first fetch specific gamecode and its players
                
                if (!response.ok) { // if response isn't okay, alert the user, set the HostLeft to true, and put them back (join page)
                    console.log("Game no longer exists - host likely left");
                    setHostLeft(true);
                    onBack();
                    return;
                }
                
                const data = await response.json();
                setPlayers(data.players); // set players to our list of players
                
                const hostPlayer = data.players.find(p => p.isHost);
                if (!hostPlayer) { // if there's no host, send everyone back
                    console.log("Host left the game - returning to previous screen");
                    setHostLeft(true);
                    onBack();
                    return;
                }
                
            } catch (error) {
                console.error('Error checking game status:', error);
                setHostLeft(true);
                onBack();
            }
        };

        pollInterval = setInterval(checkGameStatus, 1000); // poll every second
        checkGameStatus(); // initial check

        return () => {
            if (pollInterval) { // if done, clearInterval
                clearInterval(pollInterval);
            }
        };
    }, [gameData.gameCode, onBack]);  // dependency

    useEffect(() => {
        if (hostLeft && !gameData.isHost) { // if host is gone and it's not loading, alert the guests
            alert("The host has left the game. You will be returned to the join screen.");
        }
    }, [hostLeft, gameData.isHost]);

    const handleLeave = async () => {
        try {
            const response = await fetch(`http://localhost:5000/api/game/${gameData.gameCode}/leave`, { // when someone leaves, send a post request to update players list
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ // update playerlist
                    username: gameData.playerName
                })
            });

            if (!response.ok) {
                throw new Error('Failed to leave game');
            }

            const data = await response.json();
            console.log(`Successfully left game. ${data.wasHost ? 'Game deleted' : 'Player removed'}`);
            onBack();

        } catch (error) {
            console.error('Error leaving game:', error);
            onBack();
        }
    };

    return (
        <div className="lobby">
            <div className="animated-background"></div>
            <div className="back-button" onClick={handleLeave}>
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
                        <p className="status-message">{statusMessage}</p>
                    </div>
                ) : questions ? (
                    <div className="questions-ready">
                        <div className="success-icon">✓</div>
                        <h3>Questions are ready!</h3>
                        {gameData.isHost ? (
                            <button onClick={startGame} className="start-game-button">
                                Start Game
                            </button>
                        ) : (
                            <p>Waiting for host to start the game...</p>
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
