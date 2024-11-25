import React, { useState } from "react";
import '../styles/GamePlay.css';

function GamePlay({ questions, onFinish }) {
    const [currentQuestion, setCurrentQuestion] = useState(0);
    const [score, setScore] = useState(0);

    const handleAnswer = (correct) => {
        if (correct) setScore((prev) => prev + 1);
        if (currentQuestion + 1 < questions.length) {
            setCurrentQuestion((prev) => prev + 1);
        } else {
            onFinish();
        }
    };

    return (
        <div className="game-container">
            <div className="score-display">Score: {score}</div>
            <div className="question-container">
                <h2 className="question">{questions[currentQuestion].question}</h2>
                <div className="answers-grid">
                    {questions[currentQuestion].answers.map((answer, i) => (
                        <button 
                            key={i} 
                            className="answer-button"
                            onClick={() => handleAnswer(answer.correct)}
                        >
                            {answer.text}
                        </button>
                    ))}
                </div>
            </div>
            <div className="progress">
                Question {currentQuestion + 1} of {questions.length}
            </div>
        </div>
    );
}

export default GamePlay;
