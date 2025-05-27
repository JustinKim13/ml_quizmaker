import React, { useState, useEffect } from 'react';
import '../styles/JoinGame.css';

const JoinGame = ({ username, onJoin, onBack }) => {
    const [gameCode, setGameCode] = useState(''); // state to keep track of single gameCode that user is currently entering
    const [error, setError] = useState(''); // state to keep track of error being sent
    const [activeGames, setActiveGames] = useState([]); // list of active games, where each includes code and player count

    useEffect(() => { // side effect to fetch data (runs automatically after component has been rendered)
        const fetchGames = async () => { // use async to synchronously go through code
            try {
                const response = await fetch('http://localhost:5000/api/active-games'); // first check active-games endpoint
                const data = await response.json(); // get json response object from this endpoint
                setActiveGames(data.games); // from the data json response, we can now take its games attribute and set our setActiveGames state to it
            } catch (err) { // if any errors, catch them
                console.error('Error fetching games:', err);
            }
        };

        fetchGames(); // call our function
        const interval = setInterval(fetchGames, 5000); // poll every 5 seconds
        return () => clearInterval(interval); // built-in JS that stops a timer of interval
    }, []);

    const handleJoin = async (code) => { // takes in gameCode as input
        try {
            const response = await fetch('http://localhost:5000/api/join-game', { // make post request with our gameCode and username to join-game endpoint
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    gameCode: code || gameCode, 
                    username 
                }),
            });

            const data = await response.json(); // get response data regardless of status

            if (!response.ok) { // if response is not ok, throw error with server's message
                throw new Error(data.error || 'Failed to join game');
            }

            onJoin({
                gameCode: code || gameCode, 
                playerName: username,
                isHost: false, // when joining, isHost is always going to be false
                players: data.players // update list of players from data
            });
        } catch (err) { // set error state with the error message
            setError(err.message || 'Failed to join game. Please try again.');
        }
    };

    return (
        <div className="join-container">
            <div className="animated-background"></div>
            <div className="back-button" onClick={onBack}>
                ← Back
            </div>
            {/* User Profile Section */}
            <div className="user-profile">
                <div className="user-avatar">👤</div>
                <span className="username">{username}</span>
            </div>
            <div className="join-card">
                <div className="join-content">
                    <h2>Join Game</h2>
                    
                    {/* Manual code entry */}
                    <div className="code-input-group">
                        <input
                            type="text"
                            maxLength="6"
                            value={gameCode}
                            onChange={(e) => {
                                setGameCode(e.target.value.toUpperCase());
                                setError('');
                            }}
                            placeholder="ENTER CODE"
                        />
                        {error && <div className="error-message" style={{position: 'static'}}>{error}</div>}
                        <button 
                            className="join-button" 
                            onClick={() => handleJoin()}
                        >
                            Join Game
                        </button>
                    </div>

                    {/* Available games list */}
                    {activeGames.length > 0 && (
                        <div className="available-games">
                            <h3>Available Games</h3>
                            <div className="games-list">
                            {activeGames
                                .filter((game) => !game.isPrivate) // only include public games
                                .map((game) => (
                                    <div 
                                        key={game.gameCode} 
                                        className="game-item"
                                        onClick={() => handleJoin(game.gameCode)}
                                    >
                                        <span className="game-code">{game.gameCode}</span>
                                        <span className="player-count">
                                            {game.playerCount} player{game.playerCount !== 1 ? 's' : ''}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default JoinGame; 