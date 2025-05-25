import React from 'react';
import '../styles/GameOver.css';

const GameOver = ({ playerScores, questions, onPlayAgain, gameData, handleLobby }) => {
    // Sort players by score and get top 3
    const topPlayers = Object.entries(playerScores)
        .sort(([, a], [, b]) => b.score - a.score)
        .slice(0, 3)
        .map(([name, data]) => ({
            nickname: name,
            score: data.score,
            totalCorrect: data.correct || 0 // Use backend correct count
        }));

    const [first, second, third] = topPlayers;

    return (
        <div className="gameover-container">
            <div className="title-section">
                <h1 className="game-title">Game Over!</h1>
            </div>
            
            <div className="podium-section">
                <div className="podiums">
                    {/* Second Place */}
                    <div className="column">
                        {second ? (
                            <>
                                <div className="bar second-bar">
                                    <div className="score">{second.score}</div>
                                    <div className="correct">{second.totalCorrect} of {questions.length}</div>
                                </div>
                                <div className="nickname">{second.nickname}</div>
                            </>
                        ) : (
                            <div className="bar second-bar empty"></div>
                        )}
                    </div>

                    {/* First Place */}
                    <div className="column">
                        {first && (
                            <>
                                <div className="bar first-bar">
                                    <div className="score">{first.score}</div>
                                    <div className="correct">{first.totalCorrect} of {questions.length}</div>
                                </div>
                                <div className="nickname winner">{first.nickname}</div>
                            </>
                        )}
                    </div>

                    {/* Third Place */}
                    <div className="column">
                        {third ? (
                            <>
                                <div className="bar third-bar">
                                    <div className="score">{third.score}</div>
                                    <div className="correct">{third.totalCorrect} of {questions.length}</div>
                                </div>
                                <div className="nickname">{third.nickname}</div>
                            </>
                        ) : (
                            <div className="bar third-bar empty"></div>
                        )}
                    </div>
                </div>
                
                {/* Button now inside podium section */}
                {gameData.isHost ? (
                    <button onClick={onPlayAgain} className="play-again-button">
                        Play Again
                    </button>
                ) : (
                    <button onClick={handleLobby} className="play-again-button">
                        Return to Lobby
                    </button>
                )}
            </div>
        </div>
    );
};

export default GameOver; 